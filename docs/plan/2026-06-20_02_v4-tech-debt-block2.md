# Plan — Tech Debt Block 2: Limpieza de código

**Diag:** docs/diag/2026-06-18_02_deuda-tecnica-v4-beta.md (B1-B7)
**Rama:** v4-beta
**Fecha:** 2026-06-20

---

## Objetivo

Resolver siete ítems de deuda de baja prioridad (renombrado de clase, eliminación de dead code, inconsistencias de estilo/schema) identificados en el diagnóstico de v4-beta. Ningún ítem cambia comportamiento observable — todos son cambios cosméticos, de nomenclatura, o de corrección de validación menor.

---

## Pasos

### Paso 1 — Renombrar `UserServices` a `UserService` en `user.service.js` y sus consumidores `[refactor]`

**Ítem:** B1

**Archivos afectados:**
- `src/api/users/services/user.service.js` — definición de la clase (`class UserServices`)  y su `module.exports`
- `src/api/redirect/routes/redirect.route.api.js` — importa como `UserServices` en línea 10
- `src/api/groups/routes/group.route.api.js` — importa como `UserServices` en línea 8
- `src/middleware/authenticate.middleware.js` — importa como `UserServices` en línea 6
- `src/utils/auth/strategies/google-oauth2.strategy.js` — importa como `UserServices` en línea 4

**Qué cambiar:**
- En `user.service.js`: renombrar la clase de `UserServices` a `UserService`. La variable local `userService` que usan los consumidores no cambia — solo el nombre del constructor.
- En cada archivo consumidor: actualizar el identificador de la importación de `UserServices` a `UserService`. La instanciación `new UserServices()` pasa a `new UserService()`.
- `user.route.api.js` ya importa correctamente como `UserService` (singular) — verificar que no requiere cambio.

**Criterio de aceptación:** `grep -r 'UserServices' src/` no retorna ningún resultado. La suite de tests pasa sin cambios.

**Riesgo:** Este es el paso más invasivo — toca cinco archivos. Un error de nombre en cualquiera de ellos provoca una excepción de importación en tiempo de arranque. Verificar con `npm test` antes de hacer el commit.

**Tipo de commit:** `[refactor]`

---

### Paso 2 — Eliminar la instancia `userService` no utilizada en `redirect.route.api.js` `[chore]`

**Ítem:** B2

**Archivo afectado:** `src/api/redirect/routes/redirect.route.api.js`

**Estado actual (líneas 10-21):**
- Se importa `UserServices` y se instancia `const userService = new UserServices()`.
- Esa instancia se pasa como argumento a `new GroupService(userService)`.
- No existe ninguna llamada directa a `userService.` en el resto del archivo — solo actúa como argumento de constructor para `GroupService`.

**Qué cambiar:**
- Eliminar la variable `userService` y sustituir su uso por una expresión inline en la construcción de `GroupService`: `new GroupService(new UserService())`.
- Eliminar la importación de `UserService` si tras el cambio del Paso 1 ya no se referencia el nombre directamente (porque el argumento pasa a ser inline).
- Preservar la importación de `GroupService` y la instancia `groupService`, que sí se usan en los handlers de `POST /`.

**Criterio de aceptación:** `redirect.route.api.js` no declara ninguna variable `userService`. El comportamiento de `POST /` (verificación de grupo con `groupService.getBySlug`) es idéntico. La suite de tests pasa.

**Nota:** Este paso debe ejecutarse después del Paso 1 para que el nombre de la clase ya esté unificado.

**Tipo de commit:** `[chore]`

---

### Paso 3 — Eliminar dead code: `getByPathRedirectSchema` y `TWENTY_MINUTES_IN_SECONDS` `[chore]`

**Ítems:** B3 + B4

**Archivos afectados:**
- `src/api/redirect/schemas/redirect.schema.js` — definición y exportación de `getByPathRedirectSchema` (líneas 33-37 y 63)
- `src/redirect/routes/redirect.router.js` — posible destino del comentario contextual
- `src/utils/timeConst.js` — definición y exportación de `TWENTY_MINUTES_IN_SECONDS` (línea 2 y 7)

**Qué cambiar en `redirect.schema.js`:**
- Eliminar la definición `const getByPathRedirectSchema = Joi.object({...})`.
- Eliminar `getByPathRedirectSchema` del `module.exports`.
- Preservar el comentario que explica la limitación (`req.path` siempre tiene `/` inicial, incompatible con `slugPath`). Moverlo a `redirect.router.js` como comentario inline antes de `redirectRouter.get('/*', ...)`, donde sería el lugar natural si se quisiera añadir validación en el futuro.

**Qué cambiar en `timeConst.js`:**
- Eliminar `const TWENTY_MINUTES_IN_SECONDS = 20 * 60;` de la definición.
- Eliminar `TWENTY_MINUTES_IN_SECONDS` del `module.exports`.
- Verificar con `grep -r 'TWENTY_MINUTES_IN_SECONDS' src/` que no hay consumidores.

**Criterio de aceptación:** `grep -r 'getByPathRedirectSchema\|TWENTY_MINUTES_IN_SECONDS' src/` no retorna resultados. El comentario sobre la limitación de `slugPath`/`req.path` aparece en `redirect.router.js`. La suite de tests pasa.

**Tipo de commit:** `[chore]`

---

### Paso 4 — Unificar el manejo de `offset`/`limit` undefined en `redirect.route.api.js` `[style]`

**Ítem:** B5

**Archivo afectado:** `src/api/redirect/routes/redirect.route.api.js`

**Estado actual (línea 35):**
```
const options = { orderBy, offset: parseInt(offset), limit: parseInt(limit) };
```
Cuando `offset` o `limit` no están en la query, `parseInt(undefined)` produce `NaN`. El comportamiento es funcionalmente correcto porque `CrudService` evalúa `if (offset)` y `NaN` es falsy, pero el objeto `options` transporta `NaN` en lugar de `undefined`.

**Patrón correcto** (ya en uso en `group.route.api.js` línea 34 y en `user.route.api.js` líneas 58-59):
```
offset: offset ? parseInt(offset) : undefined
limit: limit ? parseInt(limit) : undefined
```

**Qué cambiar:**
- Reemplazar la construcción de `options` en el handler `GET /` de `redirect.route.api.js` para que use la guarda ternaria, consistente con los otros dos routers.

**Criterio de aceptación:** `options` nunca contiene `NaN`. La suite de tests pasa. El comportamiento de paginación es idéntico al anterior.

**Nota:** `user.route.api.js` en `GET /` también usa `parseInt` sin guarda (líneas 58-59). Este paso puede incluir esa corrección si el backend-engineer la detecta, aunque no fue listada como ítem B5. Dejarla pendiente o incluirla es a criterio del implementador — si se incluye, documentarlo en el mensaje de commit.

**Tipo de commit:** `[style]`

---

### Paso 5 — Corregir `offset: min(0)` a `min(1)` en `getGroupQuerySchema` y hacer explícita la dirección `'asc'` en `CrudService.getAll()` `[fix]` + `[style]`

**Ítems:** B6 + B7

Estos dos ítems se agrupan porque ambos tocan comportamiento de paginación/ordenación y son cambios de una línea cada uno.

**Archivo B6:** `src/api/groups/schemas/group.schema.js` línea 21

**Estado actual:**
```
offset: Joi.number().integer().min(0),
```

**Qué cambiar:** Cambiar `min(0)` a `min(1)`. `offset=0` es funcionalmente equivalente a no paginación (la guarda `if (offset)` en `CrudService` lo ignora silenciosamente), y los schemas de `redirect` y `user` ya usan `min(1)`. Aceptar `offset=0` sin error lleva a un contrato engañoso para el cliente.

**Criterio de aceptación B6:** Una petición con `offset=0` a `GET /api/v1/groups` retorna 400 (validación Joi). Las peticiones con `offset=1` o superior siguen funcionando. Tests del schema de grupo actualizados si existen.

---

**Archivo B7:** `src/utils/crud.service.js` línea 43

**Estado actual:**
```js
: fsCollection.orderBy(orderBy);
```
`orderBy(field)` sin dirección asume `asc` en Firestore, pero la intención no es legible en el código. `find()` usa `orderBy(field, 'asc')` explícitamente (línea 84). La inconsistencia entre los dos métodos del mismo servicio hace la auditoría más difícil.

**Qué cambiar:** En la rama `else` del condicional de `getAll()`, añadir el segundo argumento `'asc'` a la llamada `orderBy(orderBy)`, alineando el estilo con `find()`.

**Criterio de aceptación B7:** El comportamiento de ordenación de `getAll()` es idéntico al anterior (Firestore ya asumía `asc`). La suite de tests pasa. La lectura del código deja clara la dirección en ambos métodos.

**Tipo de commit:** Como B6 es un `[fix]` (corrección de contrato) y B7 es `[style]` (sin cambio de comportamiento), el backend-engineer puede optar por un único commit `[fix]` con ambos cambios o dos commits separados. La opción preferida es un único commit porque los cambios son de una línea cada uno y están en archivos distintos.

---

## Orden de ejecución

Los pasos deben ejecutarse en secuencia:

1. **Paso 1** primero — el renombrado de `UserServices` es prereq de Paso 2 (la importación en `redirect.route.api.js` debe estar actualizada antes de refactorizar la instancia).
2. **Paso 2** después del Paso 1.
3. **Pasos 3, 4 y 5** son independientes entre sí y del Paso 2 — pueden ejecutarse en cualquier orden tras el Paso 1.

## Estrategia de testing

No se requieren tests nuevos para los Pasos 2, 3, 4 y 7 — son cambios sin alteración de comportamiento observable.

Para el **Paso 1** (renombrado), la suite existente actúa como red de seguridad: si alguna importación queda con el nombre viejo, el módulo fallará al cargar y todos sus tests fallarán.

Para el **Paso 5 (B6)**, si existe un test que valida el schema `getGroupQuerySchema` con `offset=0` y espera éxito, ese test debe actualizarse para esperar un error 400. Si no existe tal test, el test-engineer debe añadir uno que cubra `offset=0` → 400 y `offset=1` → 200.
