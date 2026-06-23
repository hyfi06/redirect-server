# Diagnóstico Pre-Producción — v4-alpha

**Fecha:** 2026-06-22  
**Rama:** `v4-alpha`  
**Contexto:** Revisión exhaustiva del estado de la rama `v4-alpha` para determinar si está lista para despliegue en producción. Intervienen tres agentes: test-engineer (cobertura y calidad de tests), software-architect (arquitectura, seguridad, configuración), y backend-engineer (corrección del código de producción).  
**Suite de tests:** 708 tests, 39 suites, 0 fallos, 0 skipped.

---

## Resumen ejecutivo

**Veredicto global: NO listo para producción.**

| Dimensión | Estado | Veredicto |
|---|---|---|
| Tests / Cobertura | Verde | 708 tests, 99.6% statements, 98.1% branches, 100% functions |
| Seguridad | Rojo | B1: CORS abierto en producción |
| Integridad de datos | Verde | ~~B2: `UserService.delete()` no atómico~~ [RESUELTO]; ~~B3: campo `users` en grupos inconsistente~~ [RESUELTO] |
| Configuración de producción | Rojo | B4: índices Firestore deben desplegarse antes del servidor |
| Corrección del código | Verde | ~~B5: `GroupService.update()` retorna 500 en lugar de 404 sin `users`~~ [RESUELTO] |
| Issues menores | Verde | ~~M1–M4: resueltos~~ [RESUELTO]; M5: CVEs altos resueltos, 24 moderados pendientes (breaking changes) [PARCIALMENTE RESUELTO] |

Hay **cinco bloqueantes** que deben resolverse antes del despliegue. Los tests son sólidos y no son la causa del bloqueo. B2, B3 y B5 han sido resueltos (commits `e6d848f`, `356b3ed`). Quedan pendientes B1 (CORS en `app.yaml`) y B4 (orden de deploy).

---

## 1. Tests y cobertura

**Estado: LISTO**

La suite de tests cubre todos los caminos críticos del sistema:

- Autenticación: middleware JWT, API Key, OAuth2 strategy
- Autorización: `authorize`, `authorizeApiKeyScope`
- Todos los endpoints REST: redirects, users, groups, api-keys
- Catch-all público de redirects
- Error handler (404 y 500)
- `CrudService` y `FireStoreAdapter`

**Cobertura:** 99.6% statements, 98.1% branches, 100% functions.

**Gaps menores — no bloqueantes:**

| Archivo | Líneas excluidas | Motivo |
|---|---|---|
| `src/config/index.js` líneas 7–13 | Guard de startup (`process.exit(1)`) | Excluido por diseño; no testeable en Jest sin mocking de process |
| `src/api/redirect/routes/redirect.route.api.js` líneas 61–62 | Rama `catch` del `GET /` no-admin | Camino de error de baja probabilidad |
| `src/api/groups/services/group.service.js` línea 91 | Fallback defensivo `|| []` | Nunca alcanzable con el schema Joi actual |
| `src/api/users/routes/api-key.route.js` línea 71 | Retry loop en colisión de hash | Probabilidad de colisión SHA-256 despreciable en producción |

Ninguno de estos gaps requiere acción antes del despliegue.

---

## 2. Blockers

### B1 — CORS abierto en producción

**Archivo:** `src/config/index.js` / `app.yaml`  
**Agente:** software-architect  
**Severidad:** Alta

`config.cors` evalúa a `true` (es decir, `origin: true` en el paquete `cors`) cuando la variable de entorno `CORS` está ausente o es el string literal `'*'`. El `app.yaml` no define la variable `CORS`. Como resultado, cualquier origen puede realizar requests con credenciales a la API autenticada desde un navegador, dado que `origin: true` refleja el origen del request y establece `Access-Control-Allow-Credentials: true`.

La API maneja tokens JWT y datos privados de usuarios. Un origen malicioso puede leer respuestas autenticadas si el usuario tiene una sesión activa.

**Fix requerido:** Definir `CORS` en `app.yaml` (o en el pipeline de deploy) con los orígenes permitidos explícitos. Para producción, el origen debería limitarse al dominio propio o a los clientes conocidos.

---

### ~~B2 — `UserService.delete()` no es atómico~~ [RESUELTO]

**Archivo:** `src/api/users/services/user.service.js`  
**Agente:** software-architect  
**Severidad:** Alta

~~`UserService.delete()` realiza dos operaciones Firestore separadas y no atómicas.~~

**Resolución:** `UserService.delete()` ahora construye un único `WriteBatch` que incluye la delete del documento de usuario y todas las ops `FieldValue.arrayRemove(userId)` sobre los grupos afectados, comprometiendo ambas operaciones de forma atómica. El nuevo método `MembershipService.addOpsToRemoveUserFromGroups(batch, userId, userGroups)` añade las ops al batch sin hacer commit, permitiendo que el caller (UserService) controle el commit. Implementado en commits `e6d848f`/`356b3ed`.

---

### ~~B3 — Campo `users` en documentos de grupo almacena emails en lugar de IDs~~ [RESUELTO]

**Archivo:** `src/api/groups/parsers/group.parser.js` / `src/api/groups/services/group.service.js`  
**Agente:** software-architect  
**Severidad:** Alta

~~El campo `users` de los documentos de grupo almacenaba emails en lugar de IDs, causando que la lógica de delete fallara silenciosamente.~~

**Resolución:** La representación canónica del campo `users` es ahora IDs de Firestore (document IDs) en todos los niveles: schema Joi, parsers de creación y actualización, y lógica de delete/update. `GroupService.update()` compara IDs en el diff de membresía. `GroupService.delete()` y `MembershipService` operan sobre IDs. Implementado en commit `e6d848f`.

---

### B4 — Los índices Firestore deben desplegarse antes que el servidor

**Archivo:** `firestore.indexes.json` / `app.yaml`  
**Agente:** software-architect  
**Severidad:** Alta

`npm run indexes` (`firebase deploy --only firestore:indexes`) debe ejecutarse y completarse antes de `npm run deploy`. Sin los índices compuestos desplegados en Firestore, los primeros requests de usuarios no-admin que pertenezcan a al menos un grupo disparan la query `Filter.or(owner, array-contains-any)`, que requiere un índice compuesto de colección. Firestore rechaza esta query con `FAILED_PRECONDITION: The query requires an index`, que el error handler convierte en un 500 para el cliente.

El error es silencioso desde el punto de vista del operador: el servidor arranca sin problemas, pero cualquier usuario no-admin con grupos recibe 500 en `GET /api/v1/redirects` hasta que los índices estén activos. El despliegue de índices en Firestore puede tardar varios minutos.

**Fix requerido:** Documentar el orden de operaciones en el runbook de deploy y, si es posible, añadir una verificación de índices al script de deploy o al health check de startup. El orden correcto es:

1. `npm run indexes` → esperar a que los índices queden en estado `READY`
2. `npm run deploy`

---

### ~~B5 — `GroupService.update()` retorna 500 en lugar de 404 cuando el grupo no existe y el body no incluye `users`~~ [RESUELTO]

**Archivo:** `src/api/groups/services/group.service.js` línea ~129  
**Agente:** backend-engineer  
**Severidad:** Alta

~~El guard `findOne(id)` solo se ejecutaba dentro del bloque `if (group.users !== undefined)`, causando un 500 gRPC cuando el grupo no existía y el body no incluía `users`.~~

**Resolución:** `await this.findOne(id)` se ejecuta incondicionalmente al inicio de `GroupService.update()`, antes de cualquier bloque condicional. El `boom.notFound` lanzado por `CrudService.findOne()` produce un 404 correcto al cliente en todos los casos. Implementado en commit `e6d848f`.

---

## 3. Issues menores

Los siguientes ítems no bloquean el despliegue pero deben planificarse para el primer sprint post-lanzamiento.

### ~~M1 — `createUserSchema` permite valores arbitrarios en el campo `role`~~ [RESUELTO]

**Archivo:** `src/api/users/schemas/user.schema.js` línea 9  
**Agente:** backend-engineer

~~El campo `role` no tiene `.valid('user', 'admin')`. Un admin podría crear un usuario con `role: 'superadmin'` u otro string arbitrario.~~

**Resolución:** `role` es ahora `Joi.string().valid('user', 'admin')` en `createUserSchema` (y también en `updateUserByAdminSchema`). Valores fuera del enum son rechazados con 400.

---

### ~~M2 — `validatorHandler(idParamSchema, 'params')` precede a `authorize('admin')` en PATCH/DELETE de grupos~~ [RESUELTO]

**Archivo:** `src/api/groups/routes/group.route.api.js`  
**Agente:** backend-engineer

~~El middleware de validación de params corre antes del middleware de autorización.~~

**Resolución:** `authorize('admin')` precede a `validatorHandler(idParamSchema, 'params')` en las rutas `PATCH /:id` y `DELETE /:id`. Un no-admin recibe 403 antes de que se valide el formato del parámetro `id`.

---

### ~~M3 — `passport` 0.6.0 pendiente de actualizar a 0.7.0~~ [RESUELTO]

**Agente:** backend-engineer

~~`passport` 0.7.0 incluye un fix relevante para el comportamiento de `req.user` en escenarios de session-adjacent.~~

**Resolución:** `passport` actualizado a `^0.7.0` en `package.json`.

---

### ~~M4 — `CrudService.getAll()` y `find()` sin `options = {}` por defecto~~ [RESUELTO]

**Archivo:** `src/utils/crud.service.js` líneas 36 y 71  
**Agente:** backend-engineer

~~Si `getAll()` o `find()` se invocan sin argumento, el destructuring interno lanza `TypeError`.~~

**Resolución:** Firmas actualizadas a `getAll(options = {})` y `find(query, options = {})`. Invocar sin argumento ya no lanza excepción.

---

### M5 — CVEs altos resueltos; 24 moderados pendientes [PARCIALMENTE RESUELTO]

**Agente:** backend-engineer

~~No se ejecutó `npm audit` durante esta revisión.~~

**Resolución parcial:** `npm audit fix` resolvió 2 CVEs de severidad alta (`@grpc/grpc-js`, `form-data`). El audit actual reporta: 0 críticos, 0 altos, 24 moderados. Los 24 moderados restantes requieren breaking changes en dependencias y se posponen para un sprint posterior al lanzamiento.

---

## 4. Confirmaciones positivas

Los siguientes aspectos fueron auditados explícitamente y **no requieren cambios**:

| Aspecto | Veredicto |
|---|---|
| Router mount order en `src/app.js` | Correcto |
| `authenticate` a nivel de router en los tres routers protegidos | Correcto |
| `authorize('admin')` después de `authenticate` | Correcto |
| `authorizeApiKeyScope` por ruta en redirects | Correcto |
| `owner` siempre derivado de `req.user.email`, nunca del body | Correcto |
| Schemas excluyen campos inmutables (`path`, `owner`, `email`, `slug`) en updates | Correcto |
| `GroupService.delete()` y `GroupService.update()` (rama con `users`) usan WriteBatch atómico | Correcto |
| JWT: algoritmo HS256 fijado explícitamente en `sign()` y `verify()` | Correcto |
| API Key: generación con `crypto.randomBytes` + rejection sampling (sin sesgo de módulo) | Correcto |
| `toPublic()` en todas las respuestas de `User` y `ApiKey` | Correcto |
| `createUserParser` establece `role: 'user'` por defecto | Correcto |
| `GET /api/v1/groups/` para usuarios sin grupos retorna `[]` sin lanzar query inválida | Correcto |
| Sin TODO/FIXME en código de producción | Correcto |
| Helmet con defaults, sin `X-Powered-By` | Correcto |
| Path inmutabilidad enforced en dos capas (schema + updateParser) | Correcto |

---

## 5. Observaciones de arquitectura (no bloqueantes)

Las siguientes observaciones tienen impacto en la estabilidad y mantenibilidad a mediano plazo, pero no bloquean el despliegue inicial.

**`nodeCache` sin `checkperiod`:** Las entradas expiradas no se evictan proactivamente. En instancias de larga vida, el footprint de memoria crece hasta el próximo acceso a la clave. Considerar inicializar el singleton con `checkperiod: 60` (segundos).

**`expiresAt` en `ApiKey` almacenado como `Date` en lugar de `Firestore.Timestamp`:** El SDK de Firestore serializa `Date` correctamente, pero el contrato es implícito. Si en algún momento se migra la lectura a un entorno que no aplica el `docParser`, el valor llegará como `Timestamp` nativo y romperá la comparación. La práctica recomendada es usar `Firestore.Timestamp.fromDate(date)` explícitamente en los parsers de escritura.

**Límite de 10 grupos por query `in`:** `GET /api/v1/groups/` construye una query `where('slug', 'in', userGroups)`. El SDK de Firestore lanza un error si el array supera 30 elementos (límite de la API). Si un usuario tiene más de 30 grupos (posible por escrituras directas a Firestore), la query falla con 500. Para v3–v4 con volumen esperado bajo, el riesgo es aceptable, pero debe documentarse como límite conocido.

---

## 6. Checklist de producción

### Bloqueantes — deben resolverse antes del despliegue

- [ ] **B1:** Definir `CORS` en `app.yaml` o en el pipeline de deploy con los orígenes permitidos explícitos
- [x] **B2:** ~~Refactorizar `UserService.delete()` para usar un `WriteBatch` atómico~~ — resuelto en commit `e6d848f`
- [x] **B3:** ~~Establecer representación canónica del campo `users` en documentos de grupo (IDs vs emails)~~ — resuelto en commit `e6d848f`
- [ ] **B4:** Documentar y enforcer el orden de deploy: `npm run indexes` primero, `npm run deploy` después; verificar que los índices estén en estado `READY` antes de recibir tráfico
- [x] **B5:** ~~Añadir `await this.findOne(id)` incondicional al inicio de `GroupService.update()`~~ — resuelto en commit `e6d848f`

### Issues menores — primer sprint post-lanzamiento

- [x] **M1:** ~~Añadir `.valid('user', 'admin')` al campo `role` en `createUserSchema`~~ — resuelto
- [x] **M2:** ~~Invertir orden `authorize('admin')` antes de `validatorHandler` en PATCH/DELETE de grupos~~ — resuelto
- [x] **M3:** ~~Actualizar `passport` de 0.6.0 a 0.7.x~~ — resuelto (`^0.7.0`)
- [x] **M4:** ~~Añadir `options = {}` como valor por defecto en `CrudService.getAll()` y `find()`~~ — resuelto
- [~] **M5:** CVEs altos resueltos con `npm audit fix`; 24 moderados pendientes (breaking changes) — parcialmente resuelto
