# Runbook: Migración de datos a v4.1.1

**Aplica a:** instancias corriendo cualquier versión anterior a v4.1.1 que tengan datos de usuarios, grupos o redirects en Firestore.

## Contexto

v4.1 introdujo soft-delete en usuarios y grupos. Las queries que filtran `where('deletedAt', '==', null)` sólo coinciden con documentos donde el campo **existe explícitamente como `null`**. Los documentos creados antes de v4.1 no tienen el campo, por lo que:

- `UserService.getByEmail()` no los encuentra → login OAuth2 falla con 401.
- `GroupService.getBySlug()` no los encuentra → creación de redirects bajo grupos existentes falla.
- `GET /api/v1/users` y `GET /api/v1/groups` devuelven listas vacías.

Adicionalmente, v4.1.1 cambió el campo `owner` de los redirects de email a Firestore userId (document ID).

---

## Requisitos previos

- Credenciales GCP activas: `gcloud auth application-default login`
- Variable `NODE_ENV` y `.env` configurados (o exportar las variables necesarias)
- Acceso de escritura a la colección de Firestore del entorno objetivo
- Admin JWT activo en producción (para el paso 3)

---

## Paso 1 — Desplegar los índices de Firestore

v4.1 agregó dos índices compuestos requeridos por las queries de soft-delete:

```bash
npm run indexes
```

Esperar a que todos los índices alcancen estado **READY** en la [consola de Firestore](https://console.cloud.google.com/firestore/indexes) antes de continuar. Sin estos índices, las queries de listado (que ordenan por `updated` tras filtrar `deletedAt`) fallan con 500.

Índices requeridos:

| Colección | Campos |
|-----------|--------|
| `users` | `deletedAt ASC`, `updated DESC` |
| `groups` | `deletedAt ASC`, `updated DESC` |

---

## Paso 2 — Añadir `deletedAt: null` a usuarios y grupos existentes

Ejecutar el siguiente script desde la raíz del proyecto. Lee todos los documentos de las colecciones `users` y `groups` y añade `deletedAt: null` a los que no tengan el campo. Los documentos que ya lo tienen no se modifican.

```js
// node scripts/patch-deleted-at.js
require('dotenv').config();
const db = require('./src/lib/firestore-client');

async function migrateCollection(name) {
  const snap = await db.collection(name).get();
  const missing = snap.docs.filter(doc => !('deletedAt' in doc.data()));
  console.log(`[${name}] ${snap.size} docs, ${missing.length} sin deletedAt`);
  for (const doc of missing) {
    const patch = { deletedAt: null };
    if (name === 'users' && !('groups' in doc.data()))  patch.groups = [];
    if (name === 'groups' && !('users' in doc.data()))  patch.users = [];
    await doc.ref.update(patch);
    const label = doc.data().email || doc.data().slug || doc.id;
    console.log(`  parcheado ${doc.id} (${label}):`, Object.keys(patch));
  }
}

async function main() {
  await migrateCollection('users');
  await migrateCollection('groups');
  console.log('Listo.');
}

main().catch(err => { console.error(err); process.exit(1); });
```

Ejecutar:

```bash
node scripts/patch-deleted-at.js
```

### Verificación

```bash
node -e "
require('dotenv').config();
const db = require('./src/lib/firestore-client');
async function check() {
  for (const col of ['users', 'groups']) {
    const snap = await db.collection(col).get();
    const missing = snap.docs.filter(d => !('deletedAt' in d.data())).length;
    console.log(col + ': ' + snap.size + ' total, ' + missing + ' sin deletedAt');
  }
}
check().catch(console.error);
" 2>/dev/null
```

Resultado esperado: `0 sin deletedAt` en ambas colecciones.

---

## Paso 3 — Migrar `owner` de redirects (email → userId)

En versiones anteriores a v4.1 el campo `owner` de los redirects almacenaba el **email** del usuario. A partir de v4.1, almacena el **Firestore document ID** del usuario. Los redirects con owner como email no aparecen en `GET /api/v1/redirects` para el usuario propietario porque la query filtra por `owner == userId`.

### 3a. Exportar redirects actuales

```bash
BASE=https://1kg.me
TOKEN=<admin-jwt>

curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/redirects" \
  | jq '.data' > backup/redirects-raw.json

echo "Redirects exportados: $(jq length backup/redirects-raw.json)"
```

### 3b. Identificar los redirects con owner como email

```bash
jq '[.[] | select(.owner | test("@"))]' backup/redirects-raw.json
```

Si el resultado es `[]`, no hay nada que migrar — saltar al paso 4.

### 3c. Obtener el userId del propietario

Buscar el userId en `GET /api/v1/users` (admin):

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/v1/users" \
  | jq '.data[] | {id, email}'
```

### 3d. Crear los redirects migrados (sin el campo `owner`, lo asigna el servidor)

Para cada redirect con owner como email: borrar el documento original y re-crear con el admin JWT del propietario real. El servidor asigna `owner` desde `req.user.userId`.

> **Nota:** el campo `owner` es inmutable vía API — no se puede cambiar con PATCH. La única forma de migrar es borrar y re-crear.

```bash
# Borrar redirect original
curl -s -X DELETE \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE/api/v1/redirects/<id>"

# Re-crear con JWT del propietario real (o admin si se prefiere unificar)
curl -s -X POST \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"path":"<path-sin-slash-inicial>","url":"<url>","permission":[...],"categories":[...]}' \
  "$BASE/api/v1/redirects"
```

Si el path tiene namespace de grupo (e.g. `/fc/seminar`), incluir `"group":"fc"` en el cuerpo y pasar sólo `"path":"seminar"`.

---

## Paso 4 — Desplegar v4.1.1

```bash
gcloud app deploy app.yaml
```

---

## Verificación post-despliegue

1. **Login OAuth2**: abrir `https://1kg.me/api/v1/auth/google` en un navegador. El flujo debe completarse y devolver un JWT con el usuario correcto.
2. **Listado de redirects**: `GET /api/v1/redirects` con el nuevo JWT → debe retornar los redirects del usuario.
3. **Catch-all**: visitar `https://1kg.me/<path>` → debe redirigir a la URL destino.
4. **Listado de usuarios y grupos (admin)**: verificar que `GET /api/v1/users` y `GET /api/v1/groups` devuelven todos los registros activos.

---

## Rollback

No hay rollback automático. Los campos `deletedAt: null` añadidos son neutros para versiones anteriores (no existían, así que no se usaban). Si el despliegue de v4.1.1 falla, revertir el `app.yaml` al deploy anterior con:

```bash
gcloud app versions list
gcloud app services set-traffic default --splits <version-id>=1
```

Los datos migrados son compatibles con versiones anteriores — no es necesario revertirlos.
