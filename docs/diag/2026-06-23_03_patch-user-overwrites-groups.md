# Bug Report — `PATCH /api/v1/users/:id` sobreescribe `groups` con `[]` cuando el body no incluye el campo

**Fecha:** 2026-06-23
**Estado:** RESUELTO
**Severidad:** Crítica — corrupción silenciosa de datos en producción; sin error visible para el cliente
**Relacionado con:** `docs/diag/2026-06-09_04_patch-user-email-undefined-crash.md` (mismo archivo, mismo patrón de constructor)

---

## 1. Descripción del fallo

Toda solicitud a `PATCH /api/v1/users/:id` que actualice cualquier campo distinto a `groups` (por ejemplo `lastName`) borra silenciosamente el array `groups` del usuario en Firestore, reemplazándolo por `[]`.

**Comportamiento observado:**

```
PATCH /api/v1/users/DDrSZJel8fee3C9uW8aA
Body: { "lastName": "Facultad de Ciencias UNAM" }

Antes: { lastName: "Facultad", groups: ["fc", "sae"] }
Después: { lastName: "Facultad de Ciencias UNAM", groups: [] }
```

**Comportamiento esperado:** cuando `groups` no está en el body del PATCH, el campo debe permanecer intacto en Firestore. Solo los campos presentes en el payload deben actualizarse.

**Detectado el:** 2026-06-23, durante operación manual en producción. El campo fue restaurado manualmente al valor original `["fc", "sae"]`.

---

## 2. Causa raíz

El bug es el resultado de la interacción entre tres puntos del código:

### 2.1 Constructor `User` — `src/api/users/models/user.model.js`, línea 36

```js
this.groups = groups || [];
```

Cuando el handler de `PATCH /:id` construye el modelo sin incluir `groups` en el payload, `groups` desestructura como `undefined`. El operador `|| []` convierte ese `undefined` en un array vacío `[]`. El campo deja de ser `undefined` y pasa a ser un valor concreto.

### 2.2 `updateUserParser` — `src/api/users/parsers/user.parser.js`, líneas 46–58

```js
function updateUserParser(user) {
  const data = { ...user };
  deleteRegData(data);
  delete data.email;
  if (data.auth) {
    cleanDocObject(data.auth);
    if (Object.keys(data.auth).length === 0) {
      delete data.auth;
    }
  }
  cleanDocObject(data);
  return data;
}
```

`cleanDocObject` (en `src/utils/clean.data.utils.js`, líneas 6–23) elimina claves cuyo valor es `undefined` o un objeto vacío sin `null`. No elimina arrays vacíos: `[]` no es `undefined` ni un objeto vacío, por lo que `cleanDocObject` lo conserva en el payload de escritura.

### 2.3 Resultado: Firestore recibe `groups: []`

El payload que llega a `FireStoreAdapter.update()` contiene `{ lastName: "Facultad de Ciencias UNAM", groups: [] }`. Firestore interpreta esto como una instrucción de actualización parcial con `merge: false` implícito sobre los campos presentes, lo que equivale a asignar `groups = []` en el documento.

---

## 3. Por qué el mismo patrón no afectó `role`

El campo `role` en el constructor sigue un patrón diferente que fue documentado explícitamente como decisión de diseño (D20, comentario en línea 37–38 de `user.model.js`):

```js
// No default — role: undefined in a PATCH body must remain undefined so cleanDocObject omits it (D20)
this.role = role;
```

Cuando `role` no está en el body del PATCH, el constructor asigna `this.role = undefined`. `cleanDocObject` lo elimina del payload. Firestore no recibe el campo y no lo toca.

`groups` debía seguir exactamente este mismo patrón. En cambio, mantiene `|| []`, que fue probablemente copiado del estado pre-D20 del constructor o introducido por la lógica de inicialización de arreglos antes de que se estableciera la convención.

---

## 4. Impacto

### Impacto en datos

- **Afectado en producción:** usuario `DDrSZJel8fee3C9uW8aA` perdió sus membresías de grupo (`["fc","sae"]`) al procesar `PATCH` con `{"lastName":"Facultad de Ciencias UNAM"}`.
- **Restauración:** campo `groups` recuperado manualmente.
- **Usuarios potencialmente afectados:** cualquier usuario al que se le haya aplicado un `PATCH` sin el campo `groups` desde que el endpoint estuvo activo en producción.

### Impacto en permisos

`groups` no es solo metadato. El array de grupos determina:

1. Qué namespaces de path puede crear el usuario en `POST /api/v1/redirects` (validación por `slug`).
2. Qué redirects puede ver en `GET /api/v1/redirects` (filtro `array-contains-any` sobre `permission`).
3. El comportamiento de `UserService.delete()` al limpiar membresías de grupo con `WriteBatch`.

Un `groups: []` silencioso interrumpe la cadena de permisos hasta que el dato sea restaurado manualmente.

### Impacto en `GroupService.update()` / `GroupService.delete()`

Ambos servicios leen `group.users` (array de IDs de usuario) para construir `WriteBatch`. Si un usuario tiene `groups: []` por corrupción, `UserService.delete()` omitirá el `arrayRemove` de ese usuario en los grupos reales — dejando una referencia huérfana en los documentos de grupo.

---

## 5. Archivos afectados

| Archivo | Rol | Línea exacta |
|---|---|---|
| `src/api/users/models/user.model.js` | Constructor `User` — default `|| []` que causa la corrupción | 36 |
| `src/api/users/parsers/user.parser.js` | `createUserParser` — debe aplicar el default `|| []` en creación | 34 |
| `src/api/users/parsers/user.parser.js` | `updateUserParser` — no puede eliminar `groups: []` porque `cleanDocObject` no toca arrays | 46–58 |
| `src/utils/clean.data.utils.js` | `cleanDocObject` — no elimina arrays vacíos (comportamiento correcto, no debe cambiarse) | 6–23 |

---

## 6. Análisis de cobertura de tests

No existe ningún test que verifique que `PATCH /api/v1/users/:id` con un body parcial (sin `groups`) preserva el array de grupos en Firestore. Los tests actuales del handler probablemente verifican solo que el status code es 200 y que el campo actualizado se refleja en la respuesta, sin inspeccionar el payload exacto enviado a Firestore.

El gap es análogo al documentado en `docs/diag/2026-06-09_04_patch-user-email-undefined-crash.md §3`: un test que no instancie el modelo `User` con un payload real de actualización no puede detectar este tipo de fallo.

---

## 7. Corrección

La corrección consiste en dos cambios simétricos que implementan el patrón D20 para `groups`:

**En el constructor (`src/api/users/models/user.model.js`, línea 36):** reemplazar `groups || []` por `groups` — sin default. Cuando el PATCH no incluye `groups`, el constructor asigna `undefined`, y `cleanDocObject` lo omite del payload de escritura.

**En `createUserParser` (`src/api/users/parsers/user.parser.js`, línea 34):** aplicar el default en la capa de parseo de creación, no en el constructor. El resultado es `user.groups || []`, garantizando que un usuario nuevo siempre tenga `groups: []` en Firestore cuando no se especifica el campo.

Esta combinación replica exactamente la estrategia de `role` / `createUserParser`:

| Campo | Constructor | `createUserParser` | `updateUserParser` |
|---|---|---|---|
| `role` (antes del fix) | `this.role = role` | `role: user.role \|\| 'user'` | `cleanDocObject` elimina `undefined` |
| `groups` (después del fix) | `this.groups = groups` | `groups: user.groups \|\| []` | `cleanDocObject` elimina `undefined` |

El plan de corrección está en `docs/plan/2026-06-23_02_hotfix-patch-user-groups.md`.

---

## 8. Resolución

**Estado:** RESUELTO

Fix aplicado en commit `155e32d` ([fix] User.groups defaults to undefined; createUserParser sets []).  
Tests de regresión añadidos en commit `b1248ac` ([test] groups not overwritten on PATCH without groups field).  
Documentación cerrada en el commit `[docs]` de §3 de `docs/plan/2026-06-23_02_hotfix-patch-user-groups.md`.
