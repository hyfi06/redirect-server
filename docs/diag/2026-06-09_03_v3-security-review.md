# Security Review — v3-beta

**Fecha:** 2026-06-09  
**Rama:** `v3-beta`  
**Alcance:** Todos los cambios introducidos en `v3-beta` respecto a `main`. Revisión enfocada en vulnerabilidades de alta confianza (>80% de exploitabilidad real).  
**Suite de tests al momento de la revisión:** 515 tests, 29 suites, 100% passing.

---

## Resumen ejecutivo

| # | Archivo | Severidad | Categoría | Confianza |
|---|---|---|---|---|
| 1 | `src/api/redirect/routes/redirect.route.api.js:23` | Media | `authorization_bypass` | 9/10 |

Sin hallazgos de severidad alta. Un hallazgo de severidad media confirmado: bypass de autorización en el endpoint de listado de redirects para usuarios con rol `admin`.

Archivos revisados sin hallazgos: autenticación JWT, callback OAuth2, todos los handlers CRUD de redirects/users/groups, schemas Joi, construcción de queries Firestore, endpoint de health check, middleware authenticate/authorize, y validación de env al startup.

---

## Vuln 1 — `GET /api/v1/redirects` ignora el rol admin

**Archivo:** `src/api/redirect/routes/redirect.route.api.js`, líneas 23–52  
**Severidad:** Media  
**Categoría:** `authorization_bypass`  
**Confianza:** 9/10

### Descripción

El handler `GET /api/v1/redirects` construye un filtro Firestore basado exclusivamente en `req.user.email` y `req.user.groups`, sin verificar `req.user.role`. Como resultado, un usuario administrador solo ve los redirects que él mismo creó o a los que tiene permiso explícito de grupo — exactamente el mismo conjunto que vería un usuario regular.

Este comportamiento es inconsistente con el modelo de acceso aplicado en el resto de los endpoints del mismo recurso:

| Endpoint | Bypass para admin |
|---|---|
| `GET /api/v1/redirects` | ❌ **ausente** |
| `GET /api/v1/redirects/:id` (línea 64) | ✅ `req.user.role === 'admin'` |
| `PATCH /api/v1/redirects/:id` (línea 116) | ✅ guard `req.user.role !== 'admin'` |
| `DELETE /api/v1/redirects/:id` (línea 139) | ✅ guard `req.user.role !== 'admin'` |
| `GET /api/v1/groups` (línea 23) | ✅ `req.user.role === 'admin'` → `getAll()` |

Código afectado:

```js
// redirect.route.api.js líneas 26–37
const { email, groups } = req.user;
const readPermissions = groups.map(g => `read:${g}`);
const filter =
  readPermissions.length > 0
    ? Filter.or(
        Filter.where('owner', '==', email),
        Filter.where('permission', 'array-contains-any', readPermissions),
      )
    : Filter.where('owner', '==', email);
// Sin ningún check de req.user.role === 'admin'
```

### Escenario de explotación

1. El usuario admin se autentica y obtiene un JWT con `role: 'admin'`.
2. Un usuario regular crea redirects bajo su propio email.
3. El admin llama a `GET /api/v1/redirects` para auditar todos los redirects del sistema.
4. La respuesta solo contiene redirects donde `owner === admin@email` — los redirects del usuario regular son invisibles.
5. El admin no puede descubrir los IDs de esos redirects a través del listado, lo que le impide ejercer los privilegios que sí tiene correctamente en `GET /:id`, `PATCH /:id`, y `DELETE /:id`.

El resultado es un plano de control roto: los admins no pueden auditar, descubrir ni gestionar redirects que no crearon ellos mismos a través de la API de listado.

### Recomendación

Añadir un bypass para admin antes de construir el filtro, siguiendo el patrón ya establecido en `GET /api/v1/groups`:

```js
// En el handler GET / de redirect.route.api.js
if (req.user.role === 'admin') {
  const redirectArray = await redirectServicieApi.getAll({
    orderBy,
    offset: parseInt(offset),
    limit: parseInt(limit),
  });
  return res.status(200).json({ message: 'redirects retrieved', data: redirectArray });
}
// La lógica de filtro para usuarios no-admin sigue igual...
```

### Clasificación como ítem de trabajo

Este hallazgo debe documentarse como **GAP-4** en el diagnóstico de producción y resolverse antes de exponer la API a usuarios reales. No bloquea el despliegue inicial con tráfico controlado (los admins aún pueden acceder a redirects individuales por ID), pero debe corregirse antes de que los admins necesiten capacidades de auditoría.

---

## Metodología

La revisión analizó el flujo completo de datos desde las entradas de usuario hasta las operaciones sensibles:

1. **Autenticación:** JWT firmado con HS256 (algoritmo explícito después del fix SEC-2). El middleware `authenticate` verifica el token y popula `req.user = { userId, email, role, groups }`.
2. **Autorización:** El middleware `authorize(...roles)` se aplica correctamente en rutas admin-only. Las verificaciones inline de ownership siguen el patrón correcto en PATCH, DELETE, y GET /:id.
3. **Validación de entrada:** Joi schemas aplicados mediante `validatorHandler` en todos los endpoints. El campo `permission` valida el formato `^(read|edit|delete):[a-z0-9-]+$`. Query params `offset`/`limit` validados en todos los recursos.
4. **Queries Firestore:** No se encontraron inyecciones NoSQL. Los valores de usuario no se interpolan directamente en queries — se usan como valores en `Filter.where()` con parámetros tipados.
5. **OAuth2 callback:** La strategy de Google retorna 401 si el email no existe en Firestore. Los tokens se actualizan en el documento del usuario. El `done(error)` propaga fallos en lugar de swallowearlos.
6. **Health check:** `GET /_ah/health` no expone información sensible — responde solo `{ status: 'ok' }` o `{ status: 'error', message }` donde `message` es el mensaje de error de Firestore (no un stack trace).
