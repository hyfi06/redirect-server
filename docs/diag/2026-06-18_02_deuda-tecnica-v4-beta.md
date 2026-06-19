# Deuda Técnica — v4-beta

**Fecha:** 2026-06-18  
**Estado del proyecto:** v4-beta (branch `dev`)  
**Rama base:** dev  
**Suite de tests:** 696 tests, 38 suites, 100% passing

---

## Resumen ejecutivo

La rama `dev` incorpora, respecto a `v3.0.1`, los siguientes cambios estructurales: atomicidad del sync `Group.users ↔ User.groups` mediante WriteBatch, API Keys con subcollección Firestore y scope enforcement, namespace enforcement en `POST /api/v1/redirects`, y corrección del bug BUG-A del error handler (status 200 en 404/500).

Los ítems del diagnóstico anterior (`docs/diag/2026-06-10_06_deuda-tecnica-v4.md`) que han quedado resueltos son: BUG-A (error handler), la atomicidad del sync de grupos (bloque D), y los dos hallazgos de seguridad del security review `2026-06-18_01` (privilege escalation y path duplication en PATCH). Los ítems de infraestructura/operaciones (rate limiting, Secret Manager, CI/CD) permanecen abiertos y no se repiten aquí al no haber variado.

Esta auditoría identifica **tres bugs nuevos** de severidad Media y **ocho ítems de deuda** de severidad Baja o Media no documentados anteriormente. El bug más crítico para la integridad de datos es la divergencia en el patrón de verificación de unicidad en `UserService.create()` respecto a `RedirectService.create()` y `GroupService.create()`: un error de Firestore durante la comprobación de unicidad podría crear un usuario duplicado silenciosamente.

---

## 1. Bugs nuevos

### BUG-1 — `UserService.create()` no filtra errores no-404 en el check de unicidad

**Archivo:** `src/api/users/services/user.service.js:40-47`  
**Severidad:** Media  
**Estado:** Abierto

#### Descripción

`UserService.create()` comprueba unicidad de email llamando a `getByEmail()` dentro de un bloque `try/catch` genérico. Si `getByEmail()` lanza cualquier error distinto a 404 (error de red, cuota de Firestore, error de permisos), el `catch` lo absorbe silenciosamente y crea el usuario de todas formas. El bloque `catch` no distingue entre "usuario no encontrado (404, camino esperado)" y "fallo del servicio Firestore".

El patrón correcto está implementado en `RedirectService.create()` y `GroupService.create()`: ambos verifican `e.output?.statusCode !== 404` y relancean cualquier otro error. `UserService.create()` es el único servicio que no aplica esta guarda.

Consecuencia concreta: bajo un error transitorio de Firestore (query falla, create tiene éxito), el mismo email podría crearse dos veces. En producción con `query-per-user` de bajo tráfico esto es improbable pero no imposible, y no existe ningún índice de unicidad en Firestore que prevenga el duplicado a nivel de base de datos.

#### Recomendación

Añadir la guarda `if (e.output?.statusCode !== 404) throw error;` dentro del `catch` de `UserService.create()`, siguiendo el patrón establecido en `RedirectService.create()`. No requiere cambios en ningún otro archivo.

---

### BUG-2 — `RedirectServiceApi.getByPath()` tiene un `await` espurio en una llamada síncrona

**Archivo:** `src/api/redirect/services/redirect.service.js:27`  
**Severidad:** Baja  
**Estado:** Abierto

#### Descripción

```
const query = await this.db.collection.where('path', '==', path);
```

`CollectionReference.where()` es síncrono: devuelve un objeto `Query` inmediatamente. El `await` sobre un valor que no es una Promise resuelve en el mismo evento de loop y no produce un error, pero es código incorrecto: transmite la idea de que `where()` es asíncrono, lo que es falso y puede confundir a quien lea el código o lo modifique más adelante. El patrón correcto, sin `await`, está usado en `UserService.getByEmail()` y `GroupService.getBySlug()`.

#### Recomendación

Eliminar el `await` de la línea 27 de `redirect.service.js`. Cambio de una palabra; no requiere tests adicionales.

---

### BUG-3 — `DELETE /api/v1/groups/:id` no limpia `User.groups` de los miembros del grupo

**Archivo:** `src/api/groups/routes/group.route.api.js:112-125` / `src/utils/crud.service.js:126-129`  
**Severidad:** Media  
**Estado:** Abierto

#### Descripción

El handler `DELETE /api/v1/groups/:id` llama a `groupService.delete(id)`, que hereda `CrudService.delete()` sin sobreescribirlo. `CrudService.delete()` solo borra el documento del grupo en Firestore. No existe lógica de cleanup para actualizar `User.groups` de los miembros del grupo eliminado.

Resultado: después de borrar un grupo, todos los usuarios que pertenecían a él siguen teniendo el slug del grupo en su campo `groups`. Sus JWTs activos seguirán incluyendo ese slug. El endpoint `GET /api/v1/groups` de usuarios regulares consultará `find(['slug', 'in', req.user.groups])` y recibirá un array vacío para el slug eliminado (Firestore query no falla), pero el JWT sigue afirmando que el usuario pertenece al grupo.

El impacto práctico en v4-beta es moderado porque los JWTs tienen TTL de 2 horas y no existe mecanismo de auto-renovación, pero cuando se renueve el token el `req.user.groups` del usuario seguirá incluyendo el slug eliminado si `User.groups` no se limpió. También afecta a `GET /api/v1/groups/:id` donde el check de acceso usa `req.user.groups.includes(data.slug)` — si el grupo fue recreado con el mismo slug, un usuario con el slug en su JWT heredado tendría acceso aunque no haya sido añadido al nuevo grupo.

#### Recomendación

Sobreescribir `delete(id)` en `GroupService` para que, antes de borrar el documento del grupo, obtenga la lista de `users` del grupo y construya un `WriteBatch` que (1) actualice `User.groups` quitando el slug para cada miembro, y (2) borre el documento del grupo. Esto es análogo al batch write de `GroupService.update()`. Si `group.users` está vacío, el batch solo contiene la operación de borrado.

---

## 2. Inconsistencias de diseño

### DI-1 — `UserServices` vs `UserService`: clase con nombre plural, instancias con nombre singular

**Archivos:** `src/api/users/services/user.service.js:11`, y todos los archivos que importan el módulo  
**Severidad:** Baja  
**Estado:** Abierto

#### Descripción

La clase exportada se llama `UserServices` (plural). Los archivos que la importan usan nombres mixtos para la variable local: `user.route.api.js` importa como `UserService` (singular) e instancia como `const userService = new UserService()`. Los demás archivos importan como `UserServices` y también instancian como `const userService = new UserServices()`. No hay coherencia.

Los otros servicios del proyecto (`GroupService`, `RedirectServiceApi`, `ApiKeyService`) siguen la convención singular. El nombre plural en `UserServices` es un vestigio sin razón documentada.

#### Recomendación

Renombrar la clase a `UserService` (singular) en `user.service.js`. Actualizar todas las importaciones. El cambio es mecánico y el nombre `userService` para la instancia local ya es correcto en todos los sitios.

---

### DI-2 — Múltiples instancias de los servicios por módulo raíz

**Archivos:** `src/api/redirect/routes/redirect.route.api.js:19-21`, `src/api/groups/routes/group.route.api.js:16-17`, `src/middleware/authenticate.middleware.js:8-9`, `src/utils/auth/strategies/google-oauth2.strategy.js:7`  
**Severidad:** Baja  
**Estado:** Abierto

#### Descripción

Cada módulo raíz que necesita un servicio instancia su propia copia al tiempo de carga del módulo:

- `redirect.route.api.js` instancia `RedirectServiceApi`, `UserServices` y `GroupService`.
- `group.route.api.js` instancia `UserServices` y `GroupService`.
- `authenticate.middleware.js` instancia `ApiKeyService` y `UserServices`.
- `google-oauth2.strategy.js` instancia `UserServices`.

En total hay cuatro instancias de `UserServices` en el proceso. El cliente Firestore subyacente es un singleton (`firestore-client.js`), así que no hay múltiples conexiones, pero hay cuatro objetos `CrudService` con sus parsers en memoria, y el riesgo es que si los servicios añadieran caché interna en el futuro, las instancias tendrían vistas distintas.

También existe un `userService` en `redirect.route.api.js` (línea 20) que se instancia pero **nunca se usa directamente** — solo se pasa como argumento a `new GroupService(userService)`. No hay ninguna llamada directa a `userService.` en ese módulo.

#### Recomendación

A corto plazo, eliminar la instancia `userService` en `redirect.route.api.js` y construir `GroupService` con `new GroupService(new UserServices())` en línea, o extraer una función factory. A largo plazo, considerar un módulo de singletons de servicios (`src/services/index.js`) que exporte instancias únicas para evitar la proliferación de instancias.

---

### DI-3 — `getByPathRedirectSchema` exportado pero no utilizado

**Archivo:** `src/api/redirect/schemas/redirect.schema.js:35-37,63`  
**Severidad:** Baja  
**Estado:** Abierto

#### Descripción

`getByPathRedirectSchema` está definido, documentado (con un comentario que explica por qué no está conectado a ninguna ruta) y exportado, pero ningún archivo lo importa ni lo usa. Es dead code exportado, análogo a `TWENTY_MINUTES_IN_SECONDS` (BUG-C del diagnóstico anterior, todavía sin resolver en `timeConst.js`).

El comentario existente es valioso y debe preservarse si el schema se retira, porque explica la limitación de `slugPath` con Express `req.path`.

#### Recomendación

Eliminar la definición y la exportación de `getByPathRedirectSchema`. Mover el comentario explicativo al `README` o a un comentario inline en `redirect.router.js` donde el path de validación sería el lugar natural. Tratar conjuntamente con `TWENTY_MINUTES_IN_SECONDS` como un ítem de limpieza de dead code.

---

### DI-4 — Inconsistencia en el valor mínimo de `offset` entre schemas de query

**Archivos:** `src/api/redirect/schemas/redirect.schema.js:19`, `src/api/users/schemas/user.schema.js:19`, `src/api/groups/schemas/group.schema.js:21`  
**Severidad:** Baja  
**Estado:** Abierto

#### Descripción

Los tres schemas de query (`getRedirectQuerySchema`, `getUsersQuerySchema`, `getGroupQuerySchema`) declaran `offset`, pero con distintos valores mínimos:

| Schema | `offset` mínimo |
|--------|----------------|
| `redirect` | `min(1)` |
| `user` | `min(1)` |
| `group` | `min(0)` |

El schema de grupos acepta `offset=0`. Sin embargo, `CrudService.find()` y `CrudService.getAll()` tienen la guarda `if (offset)`, que trata `0` como falsy y lo ignora silenciosamente. Un cliente que envíe `offset=0` al endpoint de grupos obtiene el mismo resultado que sin offset, sin error ni advertencia. Esto es confuso y la inconsistencia entre schemas sugiere que el mínimo correcto es `1` en los tres (offset=0 es semánticamente equivalente a no paginación).

#### Recomendación

Cambiar `getGroupQuerySchema` para usar `min(1)` en `offset`, consistente con los otros schemas. Alternativamente, si offset=0 tiene semántica de "sin offset" en algún cliente, documentarlo explícitamente y añadir el mismo comportamiento a los otros schemas.

---

### DI-5 — `parseInt(undefined)` produce `NaN` en el redirect route; inconsistencia con grupo y usuario

**Archivo:** `src/api/redirect/routes/redirect.route.api.js:35`  
**Severidad:** Baja  
**Estado:** Abierto

#### Descripción

El handler `GET /api/v1/redirects` construye las opciones así:

```js
const options = { orderBy, offset: parseInt(offset), limit: parseInt(limit) };
```

Cuando `offset` o `limit` no vienen en la query, `parseInt(undefined)` produce `NaN`. `CrudService.find()` luego evalúa `if (offset)` y `if (limit)` con `NaN`, que es falsy, por lo que el comportamiento es correcto. Sin embargo, el objeto `options` transporta `{ offset: NaN, limit: NaN }` en lugar de `{ offset: undefined, limit: undefined }`, lo que es más difícil de razonar en un debugger o en un test.

Los handlers de grupos y usuarios usan la guarda `offset ? parseInt(offset) : undefined` para evitar exactamente este caso. La inconsistencia puede generar confusión futura.

#### Recomendación

Adoptar el patrón del handler de grupos/usuarios: `offset: offset ? parseInt(offset) : undefined`. Cambio de una línea en `redirect.route.api.js`.

---

### DI-6 — `getAll()` y `find()` difieren en la dirección por defecto de `orderBy` para campos personalizados

**Archivo:** `src/utils/crud.service.js:42-44,82-84`  
**Severidad:** Baja  
**Estado:** Abierto (heredado de BUG-D del diagnóstico anterior, con un matiz nuevo)

#### Descripción

`getAll()` aplica `orderBy(field)` sin dirección explícita (Firestore asume `asc`). `find()` aplica `orderBy(field, 'asc')` explícitamente. El resultado práctico es idéntico, pero la inconsistencia hace que el código sea más difícil de auditar: quien lea `getAll()` no puede asumir con certeza qué dirección se usa sin consultar la documentación de Firestore.

El diagnóstico original (BUG-D) señalaba además que `find()` sin `query` y sin `orderBy` aplica `orderBy('updated', 'desc')` antes de los filtros, pero con `query` no aplica ningún orderBy por defecto. Esto sigue sin resolverse.

#### Recomendación

En `getAll()`, cambiar `orderBy(field)` a `orderBy(field, 'asc')` para hacer explícita la dirección. En `find()`, evaluar si el `orderBy('updated', 'desc')` debe aplicarse antes o después de `where()` y documentar la decisión. Cambio cosmético con riesgo mínimo.

---

### DI-7 — `Group.delete()` delega en `CrudService.delete()` sin sobreescribir, pero `Group.update()` sí sobreescribe

**Archivo:** `src/api/groups/services/group.service.js`  
**Severidad:** Baja  
**Estado:** Abierto (relacionado con BUG-3)

#### Descripción

`GroupService` sobreescribe `update()` porque el sync de membresía requiere lógica adicional. Por consistencia y para hacer explícita la intención, también debería sobreescribir `delete()` — actualmente hereda el comportamiento base sin comentario alguno que explique por qué no se sobreescribe. Quien lea la clase en el futuro puede asumir incorrectamente que el delete no necesita sync, cuando en realidad el sync de membresía en delete está pendiente (BUG-3).

Esta es la misma situación que originó el bug de sync atómico documentado en el diagnóstico anterior: la lógica de sync se concentra en `update()` pero el delete queda sin sync.

#### Recomendación

Resolver BUG-3 implica sobreescribir `delete()` en `GroupService`. Si BUG-3 no se resuelve de inmediato, añadir un comentario en `GroupService` que documente explícitamente que `delete()` hereda `CrudService.delete()` y que el cleanup de membresía es deuda pendiente.

---

## 3. Ítems del diagnóstico anterior con estado actualizado

Los siguientes ítems del diagnóstico `2026-06-10_06_deuda-tecnica-v4.md` se registran aquí con su estado actual para preservar trazabilidad:

| ID anterior | Descripción | Estado en v4-beta |
|-------------|-------------|-------------------|
| BUG-A | errorHandler HTTP 200 en 404/500 | **Resuelto** — `error.handler.js` ahora llama `res.status(statusCode)` antes de `sendFile()` |
| BUG-B | Tests del error handler verificaban el comportamiento incorrecto | **Resuelto** — los tests fueron actualizados junto con el fix |
| BUG-C | `TWENTY_MINUTES_IN_SECONDS` dead code en `timeConst.js` | **Abierto** — sigue exportado y sin uso |
| BUG-D | `CrudService.find()` orderBy inconsistente | **Abierto** — ver DI-6 arriba |
| 3.1 | Sync Group.users ↔ User.groups no atómico | **Resuelto** — `GroupService.update()` usa WriteBatch |
| 3.5 | FireStoreAdapter instanciaba cliente Firestore por colección | **Resuelto** — `firestore-client.js` es un singleton compartido |
| 4.5 | Permisos `edit:{group}` definidos pero sin enforcement | **Parcialmente resuelto** — `edit:{group}` y `delete:{group}` tienen enforcement en PATCH y DELETE; quedaba abierto el path escalation (resuelto en security review 2026-06-18_01) |

---

## 4. Recomendaciones para v4

### Bloque A — Bugs (alta prioridad)

- [ ] **A1** Corregir `UserService.create()`: añadir `if (error.output?.statusCode !== 404) throw error;` en el catch del check de unicidad. Seguir el patrón de `RedirectService.create()` y `GroupService.create()`. `[fix]`
- [ ] **A2** Implementar `GroupService.delete()` sobreescrito con WriteBatch: obtener `group.users`, limpiar `User.groups` de cada miembro, y borrar el documento del grupo atómicamente. `[feat]`
- [ ] **A3** Eliminar el `await` espurio en `RedirectServiceApi.getByPath()` línea 27. `[style]`

### Bloque B — Limpieza de código (baja prioridad)

- [ ] **B1** Renombrar la clase `UserServices` a `UserService` en `user.service.js` y actualizar todas las importaciones. `[refactor]`
- [ ] **B2** Eliminar la instancia `userService` no utilizada directamente en `redirect.route.api.js` (línea 20). `[chore]`
- [ ] **B3** Eliminar `getByPathRedirectSchema` de `redirect.schema.js` (dead code). Preservar el comentario contextual en `redirect.router.js`. `[chore]`
- [ ] **B4** Eliminar `TWENTY_MINUTES_IN_SECONDS` de `timeConst.js` (dead code, documentado como BUG-C desde el diagnóstico anterior). `[chore]`
- [ ] **B5** Unificar el manejo de `offset`/`limit` undefined en `redirect.route.api.js`: usar `offset ? parseInt(offset) : undefined` consistente con los otros handlers. `[style]`
- [ ] **B6** Corregir `offset: min(0)` en `getGroupQuerySchema` a `min(1)` para consistencia con los schemas de redirect y user. `[fix]`
- [ ] **B7** Hacer explícita la dirección `'asc'` en el `orderBy` de `CrudService.getAll()` cuando se usa un campo personalizado. `[style]`
