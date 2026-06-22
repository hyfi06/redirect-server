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
| Integridad de datos | Rojo | B2: `UserService.delete()` no atómico; B3: campo `users` en grupos inconsistente |
| Configuración de producción | Rojo | B4: índices Firestore deben desplegarse antes del servidor |
| Corrección del código | Rojo | B5: `GroupService.update()` retorna 500 en lugar de 404 sin `users` |
| Issues menores | Amarillo | M1–M5: validación de rol, orden de middleware, dependencias |

Hay **cinco bloqueantes** que deben resolverse antes del despliegue. Los tests son sólidos y no son la causa del bloqueo.

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

### B2 — `UserService.delete()` no es atómico

**Archivo:** `src/api/users/services/user.service.js`  
**Agente:** software-architect  
**Severidad:** Alta

`UserService.delete()` realiza dos operaciones Firestore separadas y no atómicas:

1. `super.delete(id)` — elimina el documento del usuario.
2. `membershipService.removeUserFromAllGroups(id, user.groups)` — elimina el `userId` del array `users` de cada grupo al que pertenecía.

Si la segunda operación falla (timeout de Firestore, grupo eliminado concurrentemente, cuota excedida), el usuario ya no existe en la colección `users` pero su `userId` permanece en el campo `users` de los grupos afectados. El estado resultante es inconsistente y no hay mecanismo de reconciliación automática.

`GroupService.delete()` resuelve el problema simétrico de forma correcta usando un `WriteBatch` único que incluye la eliminación del documento de grupo y el `FieldValue.arrayRemove` sobre cada usuario miembro.

**Fix requerido:** Refactorizar `UserService.delete()` para construir un `WriteBatch` combinado que incluya la eliminación del documento de usuario y el `FieldValue.arrayRemove(userId)` sobre cada grupo afectado, comprometiendo ambas operaciones de forma atómica. Alternativamente, documentar la inconsistencia potencial con un runbook de reconciliación manual y aceptar la deuda explícitamente.

---

### B3 — Campo `users` en documentos de grupo almacena emails en lugar de IDs

**Archivo:** `src/api/groups/parsers/group.parser.js` / `src/api/groups/services/group.service.js`  
**Agente:** software-architect  
**Severidad:** Alta

`createGroupParser` escribe en Firestore lo que recibe del request body. El schema Joi del grupo espera emails en el campo `users` (según la validación actual). Sin embargo, `GroupService.delete()` trata los valores de `group.users` como user IDs al construir el `WriteBatch` con `FieldValue.arrayRemove(userId)`. De forma análoga, la limpieza de grupos al eliminar un usuario (`MembershipService.removeUserFromAllGroups`) recibe `userGroups` como slugs y luego usa el `userId` del argumento para el `arrayRemove`.

Esta inconsistencia de representación — emails en el campo `users` de los documentos Firestore, IDs esperados en la lógica de delete — hace que la limpieza de grupos al eliminar un grupo falle silenciosamente: el `FieldValue.arrayRemove` busca el ID pero el array contiene emails, por lo que no elimina ninguna entrada.

**Fix requerido:** Establecer una representación canónica única para el campo `users` de los documentos de grupo (preferiblemente IDs de Firestore, que son estables e independientes del email) y asegurar que el schema Joi, los parsers de creación y actualización, y toda la lógica de delete sean coherentes con esa representación.

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

### B5 — `GroupService.update()` retorna 500 en lugar de 404 cuando el grupo no existe y el body no incluye `users`

**Archivo:** `src/api/groups/services/group.service.js` línea ~129  
**Agente:** backend-engineer  
**Severidad:** Alta

En `GroupService.update()`, el guard `findOne(id)` que verifica la existencia del grupo solo se ejecuta dentro del bloque `if (group.users !== undefined)`. Si el request body contiene únicamente `name` (sin `users`), la función salta directamente a `batch.update(groupRef, ...)`. Firestore lanza un error gRPC con código 5 (NOT_FOUND) cuando el `batch.commit()` intenta actualizar un documento inexistente. Este error no es capturado por el guard de `FireStoreAdapter.update()` (que no interviene aquí, ya que el batch bypasea el adaptador), y llega al cliente como 500 en lugar de 404.

El comportamiento esperado según el contrato REST del endpoint `PATCH /api/v1/groups/:id` es retornar 404 cuando el recurso no existe, independientemente del contenido del body.

**Fix requerido:** Añadir `await this.findOne(id)` incondicionalmente al inicio de `GroupService.update()`, antes del bloque `if (group.users !== undefined)`. Esto garantiza que la existencia del grupo se verifica siempre, y el `boom.notFound` lanzado por `CrudService.findOne()` propagará un 404 correcto al cliente.

---

## 3. Issues menores

Los siguientes ítems no bloquean el despliegue pero deben planificarse para el primer sprint post-lanzamiento.

### M1 — `createUserSchema` permite valores arbitrarios en el campo `role`

**Archivo:** `src/api/users/schemas/user.schema.js` línea 9  
**Agente:** backend-engineer

El campo `role` no tiene `.valid('user', 'admin')`. Un admin podría crear un usuario con `role: 'superadmin'` u otro string arbitrario. No existe escalada de privilegios inmediata (el código de autorización solo compara contra `'admin'`), pero corrompe datos y hace el sistema frágil ante futuros checks de rol.

**Fix recomendado:** Añadir `.valid('user', 'admin').default('user')` al campo `role` en `createUserSchema`.

---

### M2 — `validatorHandler(idParamSchema, 'params')` precede a `authorize('admin')` en PATCH/DELETE de grupos

**Archivo:** `src/api/groups/routes/group.route.api.js`  
**Agente:** backend-engineer

El middleware de validación de params corre antes del middleware de autorización. Un atacante no-admin que envíe un `id` inválido recibirá un 400 de validación en lugar de un 403 de autorización, lo que confirma implícitamente que el endpoint existe y qué formato acepta el parámetro `id`.

**Fix recomendado:** Invertir el orden: `authorize('admin')` antes de `validatorHandler(idParamSchema, 'params')` en las rutas `PATCH /:id` y `DELETE /:id` del router de grupos.

---

### M3 — `passport` 0.6.0 pendiente de actualizar a 0.7.0

**Agente:** backend-engineer

`passport` 0.7.0 incluye un fix relevante para el comportamiento de `req.user` en escenarios de session-adjacent. Aunque el proyecto usa `session: false` en el callback de OAuth2 (que mitiga el vector afectado), actualizar a 0.7.x es la práctica recomendada. No es un blocker para el despliegue actual.

---

### M4 — `CrudService.getAll()` y `find()` sin `options = {}` por defecto

**Archivo:** `src/utils/crud.service.js` líneas 37 y 72  
**Agente:** backend-engineer

Si `getAll()` o `find()` se invocan sin argumento (o con `options = undefined`), el destructuring interno lanza `TypeError: Cannot destructure property 'orderBy' of undefined`. En la base de código actual, todos los call sites pasan opciones explícitas, pero es una trampa para futuros consumidores de `CrudService`.

**Fix recomendado:** Cambiar la firma a `getAll(options = {})` y `find(query, options = {})`.

---

### M5 — `npm audit` pendiente

**Agente:** backend-engineer

No se ejecutó `npm audit` durante esta revisión. Antes del despliegue en producción, verificar que no existan CVEs de severidad alta o crítica en el lockfile actual.

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
- [ ] **B2:** Refactorizar `UserService.delete()` para usar un `WriteBatch` atómico, o documentar la inconsistencia potencial con runbook de reconciliación
- [ ] **B3:** Establecer representación canónica del campo `users` en documentos de grupo (IDs vs emails) y hacer coherentes los parsers, schema Joi y lógica de delete
- [ ] **B4:** Documentar y enforcer el orden de deploy: `npm run indexes` primero, `npm run deploy` después; verificar que los índices estén en estado `READY` antes de recibir tráfico
- [ ] **B5:** Añadir `await this.findOne(id)` incondicional al inicio de `GroupService.update()` (`src/api/groups/services/group.service.js`)

### Issues menores — primer sprint post-lanzamiento

- [ ] **M1:** Añadir `.valid('user', 'admin')` al campo `role` en `createUserSchema`
- [ ] **M2:** Invertir orden `authorize('admin')` antes de `validatorHandler` en PATCH/DELETE de grupos
- [ ] **M3:** Actualizar `passport` de 0.6.0 a 0.7.x
- [ ] **M4:** Añadir `options = {}` como valor por defecto en `CrudService.getAll()` y `find()`
- [ ] **M5:** Ejecutar `npm audit` y resolver CVEs de severidad alta o crítica
