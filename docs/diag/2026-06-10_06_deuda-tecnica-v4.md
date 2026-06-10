# Deuda Técnica — v4

**Fecha:** 2026-06-10
**Estado del proyecto:** v3.0.1
**Rama base:** dev

---

## Resumen ejecutivo

El proyecto llegó a v3.0.1 con la API v1 completa, autenticada y probada al 100%. Los ítems bloqueantes para producción (auth, índices Firestore, validación de env al startup, control de acceso en endpoints) fueron resueltos en los sprints de v3-alpha y v3-beta. Dos bugs post-release han sido documentados: el crash de `PATCH /api/v1/users/:id` (resuelto en 3.0.1) y el código HTTP incorrecto en respuestas 404/500 HTML (pendiente).

Las prioridades críticas para v4 son tres: (1) corregir el bug del error handler que emite HTTP 200 en lugar de 404/500, incluyendo sus tests que hoy verifican el comportamiento incorrecto; (2) completar la atomicidad del sync `Group.users ↔ User.groups` mediante Firestore batch writes; (3) añadir rate limiting ahora que el sistema está autenticado, ya que el endpoint de auth y el catch-all de redirects son públicos y sin protección.

El enfoque recomendado para v4 es consolidar la estabilidad del sistema existente antes de añadir funcionalidad: corregir los dos bugs pendientes, resolver los gaps de robustez (timeouts Firestore, cold starts, sync atómico) y añadir las capas de protección operacional (rate limiting, Secret Manager). La funcionalidad nueva de producto — namespace enforcement en paths, permisos `edit:{group}`, API Keys — debe venir después de esta base.

---

## 1. Bugs conocidos sin resolver

| ID | Descripción | Severidad | Archivo afectado | Referencia |
|----|-------------|-----------|-----------------|------------|
| BUG-A | `errorHandler` sirve NotFound.html y serverError.html con HTTP 200 en lugar de 404/500. `res.sendFile()` no hereda el status — Express usa 200 por defecto. | Media | `src/middleware/error.handler.js:47,49` | `docs/diag/2026-06-10_05_error-handler-404-wrong-status.md` |
| BUG-B | Los tests del error handler verifican el comportamiento incorrecto: `expect(mockRes.status).not.toHaveBeenCalled()` en la rama 404 y en la 500/producción. Al corregir el código, los tests fallarán si no se actualizan. | Media | `src/middleware/__test__/error.handler.test.js:61,62` | `docs/diag/2026-06-10_05_error-handler-404-wrong-status.md` |
| BUG-C | `TWENTY_MINUTES_IN_SECONDS` está exportada en `src/utils/timeConst.js` pero nunca importada en ningún archivo de producción. Dead code exportado. | Baja | `src/utils/timeConst.js:2` | Identificado en esta auditoría |
| BUG-D | `CrudService.find()` con `query = null` y sin `orderBy` aplica `.orderBy('updated', 'desc')` sobre la `CollectionReference` base antes de añadir filtros, pero con `query` presente no añade ningún `orderBy` por defecto. El resultado es que dos llamadas `find(query, {})` con distinto query tienen comportamiento de ordenamiento diferente (línea 74: `else if (!orderBy)`). | Baja | `src/utils/crud.service.js:74` | `docs/diag/2026-06-04_01_diagnostico-arquitectura.md` BUG-7 |

---

## 2. Gaps de cobertura de tests

| Módulo | Tipo de gap | Impacto |
|--------|------------|---------|
| `src/middleware/error.handler.js` | Tests actuales verifican que `res.status` NO es llamado en ramas 404 y 500/prod — comportamiento que el fix del BUG-A debe cambiar. Al aplicar el fix, los tests romperán si no se actualizan simultáneamente. | Alto — bloquea el fix del BUG-A |
| `src/middleware/error.handler.js` | No existe ningún test que verifique que la respuesta 404 tiene `statusCode === 404` (solo verifica que se llama `sendFile`). La superficie del bug es que el status code es 200, pero el test no lo detecta. | Alto |
| `src/api/redirect/routes/redirect.route.api.js` | No existe test de integración end-to-end que verifique el código HTTP devuelto por operaciones sobre recursos inexistentes (404 propagado correctamente). Los tests actuales mockean el servicio y no ejercen el error handler real. | Medio |
| `src/utils/crud.service.js` | `find()` con un objeto `Filter` compuesto (el caso `Filter.or` de redirects) no tiene test unitario que verifique el spread `...query` con un `Filter` como primer elemento. El comportamiento funciona porque Firestore SDK acepta `collection.where(Filter)`, pero no está cubierto. | Medio |
| `src/api/groups/services/group.service.api.js` | El escenario de inconsistencia parcial — `update()` falla a mitad del loop de sync de usuarios — no tiene test. Solo se prueban casos de éxito y error total. | Medio |
| `src/utils/auth/strategies/google-oauth2.strategy.js` | El escenario donde `userService.update()` falla (tokens no actualizados) no tiene test que verifique que `done(error)` es llamado y el login falla. Solo se prueba login exitoso y usuario no registrado. | Medio |
| `src/routes/health.js` | El test del health check no verifica el caso en que Firestore está caído y retorna 503 (solo el caso happy path). | Bajo |
| `src/api/users/routes/user.route.api.js` | No existe test que verifique que `PATCH /:id` por un admin sobre otro usuario devuelve el `email` correcto del usuario editado en la respuesta (no el del admin). La Opción A del fix fue descartada precisamente por este bug de presentación — debería estar cubierta como regresión. | Bajo |

---

## 3. Limitaciones arquitectónicas

**3.1 Sync Group.users ↔ User.groups no es atómico**
El método `GroupService.update()` ejecuta N llamadas `userService.update()` en un bucle secuencial. Si cualquier llamada falla después de que algunas hayan completado, el estado entre las colecciones `groups` y `users` queda inconsistente. El documento del grupo se actualiza solo después de todos los updates de usuarios, pero si un update de usuario falla a mitad del loop, los usuarios anteriores ya fueron modificados. Firestore batch write y transactions son la solución, pero requieren refactorizar `FireStoreAdapter` para exponer el cliente `Firestore` singleton en lugar de instanciar un adaptador por colección. Referencia: `docs/diag/2026-06-08_02_v3-production-readiness.md` DT-1.

**3.2 Sin timeouts en operaciones Firestore**
Todas las Promises de Firestore (`.get()`, `.add()`, `.update()`, `.delete()`, `.where().get()`) no tienen timeout. Si Firestore está lento o caído, las requests cuelgan hasta que el cliente las cancela o GAE impone su timeout de 60 segundos. Con `min_instances: 0` en `app.yaml`, una instancia fría enfrentando Firestore degradado puede no responder nunca. El SDK de `@google-cloud/firestore` expone `settings.timeout` en el constructor, o se puede envolver con `Promise.race`. Referencia: `docs/diag/2026-06-08_02_v3-production-readiness.md` ROB-1.

**3.3 `CrudService.find()` acepta `query` como array spread o como objeto Filter, pero no los diferencia**
La firma `find(query, options)` se usa de dos formas distintas en el código: con un array spread (`['slug', 'in', slugs]`) y con un array que contiene un objeto `Filter.or` compuesto (`[Filter.or(...)]`). Ambas funcionan porque Firestore SDK acepta ambas formas en `.where()`. Sin embargo, la API interna es ambigua — no es obvio para quien lee el código que `query` puede ser tanto un array de tres strings como un array con un único objeto `Filter`. Esto crea riesgo de regresión si se cambia la implementación de `find`.

**3.4 Namespace enforcement de paths no verificado contra grupos reales en Firestore**
El handler `POST /api/v1/redirects` verifica que el usuario pertenece al grupo del path solo usando `req.user.groups` (el array del JWT, populado en el momento del login). Si el admin agrega o quita al usuario de un grupo después de que el usuario se autenticó, el JWT sigue conteniendo los grupos del momento del login. El usuario podría crear paths bajo grupos a los que ya no pertenece (o ser rechazado bajo grupos a los que sí pertenece) hasta que renueve el token. Para v3 es aceptable; para producción con cambios de membresía frecuentes, es un gap.

**3.5 `FireStoreAdapter` instancia un cliente Firestore por colección**
Cada instancia de `FireStoreAdapter` crea `new Firestore.Firestore()` en su constructor. En una aplicación con tres colecciones, se crean tres clientes Firestore. El SDK de Google maneja esto internamente (los pools de conexión son compartidos por el proceso), pero es un patrón ineficiente que impide usar batch writes y transactions entre colecciones distintas.

---

## 4. Seguridad pendiente

**4.1 Sin rate limiting en ningún endpoint (Alta)**
Los endpoints `GET /api/v1/auth/google` e `GET /api/v1/auth/google/callback` son públicos y pueden recibir miles de requests sin restricción. El endpoint catch-all de redirects (`GET /*`) también es público. El diagnóstico v3 (SEC-6) dejó esto como deuda explícita para implementar después de completar la autenticación. El sistema ahora está autenticado. Librería recomendada: `express-rate-limit`. Estrategia: por IP para endpoints de auth, por `req.user.email` para endpoints API autenticados.

**4.2 Secretos en texto plano en el entorno de despliegue (Alta)**
`JWT_SECRET` y `GOOGLE_CLIENT_SECRET` se configuran como variables de entorno en la consola de GAE o en `app.yaml`. La práctica correcta para producción es Google Secret Manager con carga en runtime. Sin Secret Manager, cualquier persona con acceso al proyecto GCP puede leer los secretos en la consola. El servidor valida que las variables existan al startup (implementado), pero no impone que provengan de Secret Manager.

**4.3 Tokens OAuth2 almacenados en el documento principal de User (Media)**
`user.auth.googleToken` y `user.auth.googleRefreshToken` se almacenan como campos del documento de usuario en Firestore. La mitigación `toPublic()` impide que aparezcan en respuestas HTTP, pero cualquier lectura directa de Firestore (consola GCP, exports, backups) expone los tokens. La solución correcta es mover los tokens a una subcolección separada `users/{id}/tokens/{provider}`. Diferida en v3 por requerir migración de datos. Referencia: `docs/diag/2026-06-04_01_diagnostico-arquitectura.md` DIS-5.

**4.4 Passport OAuth2 sin validación explícita de state en staging (Baja)**
No se ha verificado en staging que el callback rechaza requests sin el parámetro `state` correcto. `passport-google-oauth2` implementa protección de state, pero la validación no ha sido confirmada experimentalmente. Referencia: `docs/diag/2026-06-08_02_v3-production-readiness.md` SEC-5.

**4.5 Permisos `edit:{group}` y `delete:{group}` definidos en schema pero sin enforcement (Media)**
El schema Joi en `redirect.schema.js` acepta entradas con prefijo `edit:` y `delete:` en el campo `permission`. Sin embargo, ningún handler verifica estos scopes para operaciones de modificación. Solo `owner` y `admin` pueden actualmente editar o borrar. Los permisos granulares por grupo están en el modelo de datos pero sin lógica de enforcement.

---

## 5. Infraestructura / operaciones

**5.1 `min_instances: 0` — cold starts en producción (Diferido desde v3)**
`app.yaml` configura `min_instances: 0`. El primer request a una instancia fría paga el costo de startup de Node.js 24 más la inicialización de la conexión a Firestore. Para el redirect catch-all donde la latencia es perceptible por el usuario final, esto puede resultar en respuestas de varios segundos tras periodos de inactividad. `min_instances: 1` elimina el cold start al costo de facturar una instancia permanente. Referencia: `docs/diag/2026-06-08_02_v3-production-readiness.md` CFG-3.

**5.2 Sin índices Firestore declarados como código**
Los índices compuestos requeridos por las queries de la API v1 no están en un archivo `firestore.indexes.json` versionado. Las instrucciones para crearlos están en el README y en el diagnóstico de producción, pero no son reproducibles automáticamente. Si se destruye y recrea el proyecto GCP, los índices se pierden y la API falla con `FAILED_PRECONDITION`. La instrucción `firebase deploy --only firestore:indexes` con un `firestore.indexes.json` en el repositorio resolvería esto. Referencia: `docs/diag/2026-06-08_02_v3-production-readiness.md` CFG-2 apéndice.

**5.3 Sin pipeline de CI/CD**
No existe GitHub Actions ni equivalente. Los tests se ejecutan manualmente con `npm test`. El deploy es manual con `npm run deploy`. Un commit defectuoso puede llegar a producción sin pasar los 500+ tests. Mínimo viable: un workflow de GitHub Actions que ejecute `npm test` en cada PR y bloquee el merge si falla.

**5.4 Sin logging estructurado para errores de negocio en los route handlers**
`src/utils/logger.js` implementa logging JSON para producción y fue integrado en `GroupService` para errores de sync. Sin embargo, los route handlers de redirects, users, y auth no logean nada antes de llamar `next(error)`. Errores de negocio (403 forbidden, 409 conflict de slug/email/path duplicado) no dejan rastro en Cloud Logging salvo el error HTTP que el cliente recibe.

**5.5 Health check no valida colecciones de la API**
`GET /_ah/health` hace `db.collection.limit(1).get()` sobre la colección `redirects`. Si las colecciones `users` o `groups` tienen un problema de conectividad o permisos, el health check responde 200 igualmente. Para una validación más completa, el health check debería probar al menos una operación de lectura en cada colección crítica.

---

## 6. Producto — funcionalidad no implementada

**6.1 Frontend de administración**
No existe ninguna interfaz web para gestionar redirects, usuarios y grupos. La API v1 está completa y documentada, pero el producto requiere un frontend para que usuarios no técnicos puedan operar el sistema. La arquitectura lo soporta (CORS configurable, JWT en Bearer header, `GET /me` para perfil), pero el frontend no ha sido iniciado.

**6.2 Enforcement de namespace en paths para usuarios regulares — verificación incompleta**
El handler `POST /api/v1/redirects` verifica que el primer segmento del path coincida con un grupo del JWT del usuario. Sin embargo, no verifica que ese slug exista como `Group` en Firestore. Un usuario podría crear un path `/{slug}/foo` donde `{slug}` es un grupo al que pertenece según su JWT pero cuyo documento de grupo fue eliminado de Firestore después de emitir el token. CLAUDE.md especifica que el primer segmento debe coincidir con el `slug` de un grupo válido.

**6.3 Permisos de edición por grupo (`edit:{group}`) sin enforcement**
Descrito en 4.5. La visión de producto en CLAUDE.md menciona `permission: string[]` con `"read:{group}"`, pero el sistema real solo tiene enforcement para `read`. Los permisos de edición delegada a grupos (sin ser el owner) no están implementados.

**6.4 Listado de redirects sin paginación desde el cliente redirect**
El redirect catch-all no tiene ningún endpoint para que el frontend liste los redirects públicos (sin autenticación). Toda consulta requiere JWT. Si en el futuro se quiere mostrar una página de discovery pública de redirects de un grupo, no hay endpoint para eso.

**6.5 Ausencia de endpoint de registro de nuevos usuarios**
Los usuarios solo pueden ser creados por admins (`POST /api/v1/users` requiere `authorize('admin')`). No existe un flujo de registro self-service ni un endpoint para que Google OAuth2 cree automáticamente el usuario si no existe. La strategy de OAuth2 en `google-oauth2.strategy.js` línea 26 retorna `done(null, false, { message: 'User not registered' })` si el email no está en Firestore. Para que el sistema escale a más usuarios, un admin debe crearlos manualmente primero.

**6.6 Sin mecanismo de revocación de JWT**
Los JWT firmados son válidos hasta su expiración (default `JWT_TTL=2h`). No existe ningún mecanismo para invalidar un token antes de que expire (logout, cambio de contraseña, desactivación de cuenta). Un usuario cuya cuenta sea desactivada por un admin seguirá pudiendo usar la API durante hasta 2 horas con su token actual.

**6.7 Sin endpoint de logout**
No existe `POST /api/v1/auth/logout`. En un sistema sin revocación de JWT (ver 6.6), un endpoint de logout solo puede ser simbólico en el cliente, pero su ausencia también impide cualquier implementación futura de revocación.

---

## 7. Recomendaciones para v4

### Bloque A — Bugs y correcciones inmediatas (sprint 1)

- [ ] **A1** Corregir `src/middleware/error.handler.js`: añadir `.status(statusCode)` antes de `.sendFile()` en ramas 404 y 500/prod. Corregir simultáneamente los tests del error handler para verificar el status code correcto. `[fix] + [test]`
- [ ] **A2** Eliminar `TWENTY_MINUTES_IN_SECONDS` de `src/utils/timeConst.js` (dead code exportado). `[chore]`
- [ ] **A3** Añadir test de regresión que verifique el status code HTTP en la respuesta de `errorHandler` para 404 y 500 (no solo que `sendFile` fue llamado). `[test]`

### Bloque B — Robustez operacional (sprint 1-2)

- [ ] **B1** Evaluar y decidir `min_instances: 1` en `app.yaml` para eliminar cold starts en el redirect catch-all. Costo estimado: ~$15-20/mes en GAE standard. `[chore]`
- [ ] **B2** Añadir `firestore.indexes.json` al repositorio con los índices compuestos documentados en el apéndice del diagnóstico `2026-06-08_02`. Configurar `firebase.json` para deploys de solo índices. `[chore]`
- [ ] **B3** Implementar timeouts en operaciones Firestore. Opción mínima: `Firestore.settings({ timeout: 10000 })` en `FireStoreAdapter`. Opción completa: `Promise.race` con timeout configurable. `[feat]`
- [ ] **B4** Configurar GitHub Actions: workflow `ci.yml` que ejecute `npm test` en cada push a `dev` y en cada PR a `main`. `[chore]`

### Bloque C — Seguridad (sprint 2)

- [ ] **C1** Añadir `express-rate-limit` al proyecto. Configurar: 20 req/min por IP en `/api/v1/auth/google` y `/api/v1/auth/google/callback`; 100 req/min por `req.user.email` en endpoints autenticados; 200 req/min por IP en `GET /*` (redirect catch-all). `[feat]`
- [ ] **C2** Integrar Google Secret Manager para `JWT_SECRET` y `GOOGLE_CLIENT_SECRET`. Carga en runtime antes de `app.listen`. `[chore]`
- [ ] **C3** Verificar en staging que el callback de OAuth2 rechaza requests sin parámetro `state` correcto (SEC-5 pendiente desde v3). `[test]`

### Bloque D — Atomicidad del sync de grupos (sprint 2-3)

- [ ] **D1** Refactorizar `FireStoreAdapter` para exponer el cliente `Firestore` singleton como propiedad de instancia o como módulo singleton. Prerequisito para batch writes. `[refactor]`
- [ ] **D2** Reemplazar el bucle secuencial de `userService.update()` en `GroupService.update()` con un Firestore batch write que actualice el documento del grupo y todos los documentos de usuario afectados en una sola operación atómica. `[feat]`
- [ ] **D3** Añadir tests de `GroupService.update()` para el escenario de fallo parcial (algunos updates de usuario fallan a mitad del diff). `[test]`

### Bloque E — Funcionalidad de producto (sprint 3-4)

- [ ] **E1** Implementar enforcement completo del namespace de paths: verificar que el grupo existe en Firestore (no solo en el JWT) al crear un redirect. `[feat]`
- [ ] **E2** Implementar `POST /api/v1/auth/logout` con invalidación de token (requiere decisión arquitectónica sobre almacenamiento de revocación: Redis, Firestore, o simplemente TTL corto). `[feat]`
- [ ] **E3** Definir política de creación de usuarios: ¿self-service vía OAuth2 con aprobación de admin, o solo creación manual por admin? Implementar según la decisión. `[feat]`
- [ ] **E4** Iniciar el frontend de administración. La API está lista. `[feat]`

### Bloque F — Deuda técnica menor (cualquier sprint)

- [ ] **F1** Mover tokens OAuth2 (`user.auth`) a subcolección `users/{id}/tokens` en Firestore. Requiere migración de datos. `[refactor]`
- [ ] **F2** Añadir logging de errores de negocio en route handlers antes de llamar `next(error)`. `[chore]`
- [ ] **F3** Implementar enforcement de permisos `edit:{group}` en `PATCH /api/v1/redirects/:id`. `[feat]`
- [ ] **F4** Estandarizar la firma de `CrudService.find()` para diferenciar explícitamente entre queries simples (array spread) y queries compuestas (objeto Filter). `[refactor]`
