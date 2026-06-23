# Security Review — v4-beta

**Fecha:** 2026-06-18  
**Rama:** `v4-beta`  
**Alcance:** Todos los cambios introducidos en `v4-beta` respecto a `main`. Revisión enfocada en vulnerabilidades de alta confianza (>80% de exploitabilidad real). Sprint cubierto: Sprint 0–3 (autenticación, API Keys, permisos de grupo, namespace de paths).  
**Suite de tests al momento de la revisión:** 696 tests, 38 suites, 100% passing.

---

## Resumen ejecutivo

| # | Archivo | Severidad | Categoría | Confianza | Estado |
|---|---|---|---|---|---|
| 1 | `src/api/redirect/routes/redirect.route.api.js` | Alta | `privilege_escalation` | 9/10 | Resuelto |
| 2 | `src/api/redirect/routes/redirect.route.api.js` | Media | `authorization_bypass` | 9/10 | Resuelto |

Dos hallazgos confirmados, ambos en el handler `PATCH /api/v1/redirects/:id`. La infraestructura de API Keys (generación criptográfica, hashing SHA-256, scope enforcement, subcollección Firestore) es sólida. La autenticación JWT y OAuth2 no presentan vulnerabilidades nuevas.

Archivos revisados sin hallazgos: `authenticate.middleware.js`, `authorize-api-key-scope.middleware.js`, `api-key.service.js`, `api-key.route.js`, `api-key.model.js`, `api-key.parser.js`, `api-key.schema.js`, `firestore-client.js`, `firestore.js`, `group.service.js`, `user.route.api.js`, `group.route.api.js`.

---

## Vuln 1 — `PATCH /api/v1/redirects/:id` no aplica reglas de namespace al nuevo path

**Archivo:** `src/api/redirect/routes/redirect.route.api.js`  
**Severidad:** Alta  
**Categoría:** `privilege_escalation`  
**Confianza:** 9/10

### Descripción

El handler `POST /api/v1/redirects` hace cumplir las reglas de namespace: los usuarios no-admin deben suministrar un grupo al que pertenecen, el primer segmento del path es verificado contra `groupService.getBySlug()`, y el path final se construye como `/{group}/{path}`. El handler `PATCH /api/v1/redirects/:id` únicamente verifica permisos de edición sobre el documento *existente* y a continuación llama directamente a `redirectServicieApi.update()` sin inspeccionar el valor de `req.body.path`.

`updateRedirectSchema` acepta `path` como campo opcional (tipo `slugPath`). Como resultado, cualquier usuario que tenga permiso de edición sobre un redirect puede cambiar su path a cualquier valor arbitrario, incluyendo paths de nivel raíz reservados para admins o segmentos de grupos a los que no pertenece.

Adicionalmente, `updateRedirectSchema` usa el tipo `slugPath` (sin `/` inicial), mientras que los paths almacenados en Firestore tienen `/` inicial (el `POST` lo antepone). Un PATCH que cambie el path lo almacenaría sin `/` inicial, haciendo el redirect permanentemente inalcanzable por el router catch-all.

### Escenario de explotación

1. La usuaria `alice` pertenece al grupo `fc`. Es dueña del redirect `/fc/seminar`.
2. Envía `PATCH /api/v1/redirects/<id>` con body `{ "path": "admin/promo" }`.
3. No se ejecuta ningún check de namespace. `update()` escribe el nuevo path en Firestore.
4. El router catch-all ahora sirve `1kg.me/admin/promo` apuntando al destino de alice — un path de nivel raíz que solo los admins deberían poder crear.
5. Alternativamente, alice puede usar `path: "cs/event"` para apropiarse de un segmento del grupo `cs` al que no pertenece.

### Recomendación

Replicar en el handler PATCH la misma verificación de namespace aplicada en POST: si `req.body.path` está presente, verificar que el primer segmento coincide con uno de `req.user.groups` (o saltarse el check si `req.user.role === 'admin'`). Considerar si `path` debería ser inmutable tras la creación — si es así, eliminarlo de `updateRedirectSchema`.

---

## Vuln 2 — `PATCH /api/v1/redirects/:id` no verifica unicidad del nuevo path

**Archivo:** `src/api/redirect/routes/redirect.route.api.js` / `src/api/redirect/services/redirect.service.js`  
**Severidad:** Media  
**Categoría:** `authorization_bypass`  
**Confianza:** 9/10

### Descripción

`RedirectServiceApi.create()` llama a `getByPath()` para garantizar que el path no exista antes de insertar. `RedirectServiceApi` no sobreescribe `update()`, por lo que hereda `CrudService.update()` que escribe en Firestore sin ningún check de unicidad. El handler PATCH tampoco añade esta verificación.

Si un usuario cambia el path de su redirect a un valor que ya está en uso por otro usuario, Firestore escribe ambos documentos sin error. El router catch-all usa `where('path', '==', path)` sin un orden determinístico entre duplicados — uno de los dos redirects queda permanentemente inalcanzable sin ningún error visible.

### Escenario de explotación

1. `bob` es dueño del redirect `/fc/event`.
2. `alice` es dueña de `/fc/seminar`. Envía `PATCH /api/v1/redirects/<alice-id>` con `{ "path": "fc/event" }`.
3. Ahora dos documentos almacenan el path `fc/event`. Firestore devuelve uno de forma no determinística; el redirect de bob queda roto de forma permanente y silenciosa.

### Recomendación

Añadir un check de unicidad en el handler PATCH (o sobreescribir `RedirectServiceApi.update()`) antes de llamar a `update()`, equivalente al de `create()`. Eximir el caso en que el nuevo path sea igual al path actual del documento (renombrado no-op). Si `path` es inmutable, eliminarlo de `updateRedirectSchema` resuelve ambas vulnerabilidades a la vez.

---

## Metodología

La revisión analizó el flujo de datos desde las entradas de usuario hasta las operaciones sensibles en los archivos nuevos y modificados del branch:

1. **Infraestructura de API Keys:** Generación con `crypto.randomBytes` + rejection sampling (bias eliminado). Hash SHA-256, prefijo `sk_1kg_`, almacenamiento solo del hash. Guard de unicidad en `ApiKeyService.create()` via `findByHash()` antes de escritura. Correcta separación de `toPublic()` (nunca expone `keyHash`). Sin hallazgos.
2. **Autenticación:** El dispatcher en `authenticate.middleware.js` detecta el prefijo `sk_1kg_` y delega correctamente. La caché de 30 s es un trade-off documentado y aceptado; las rutas de gestión de usuarios/grupos rechazan API Keys antes del check de rol, eliminando el vector de escalada de privilegios por caché stale. Sin hallazgos nuevos.
3. **Scope enforcement:** `authorizeApiKeyScope` es un no-op para JWT (correcto). Para API Keys, retorna 403 si el scope requerido no está en `req.user.apiKey.scopes`. Aplicado correctamente en los 5 endpoints de redirects. Sin hallazgos.
4. **Namespace de paths:** POST aplica correctamente las reglas de namespace. PATCH no las aplica — hallazgo Vuln 1.
5. **Unicidad de paths:** Solo garantizada en `create()`. No en `update()` — hallazgo Vuln 2.
6. **Queries Firestore:** No se encontraron inyecciones NoSQL. Los valores de usuario se pasan como parámetros tipados a `Filter.where()`, nunca interpolados como strings.
7. **WriteBatch en GroupService:** La atomicidad del batch garantiza consistencia entre el documento de grupo y los documentos de usuario. Timestamps establecidos manualmente (correcto, ya que el batch no pasa por FireStoreAdapter). Sin hallazgos.
