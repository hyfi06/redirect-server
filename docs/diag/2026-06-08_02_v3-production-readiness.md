# Diagnóstico v3 — Production Readiness

**Fecha:** 2026-06-08  
**Rama:** `v3-beta`  
**Contexto:** Análisis exhaustivo del estado de la rama `v3-beta` para determinar qué falta antes de desplegar en producción. Suite de tests actual: 27 suites, 483 tests, 100% passing, 100% cobertura.

---

## 1. Resumen ejecutivo

**Actualización 2026-06-09:** Los ítems bloqueantes y de alta prioridad han sido implementados (specs `2026-06-09_01` y `2026-06-09_02`). Los ítems de media prioridad siguen pendientes de spec.

| Dimensión | Estado | Veredicto |
|---|---|---|
| Gaps funcionales | Verde | GAP-1 y GAP-2 implementados; GAP-3 (query param validation) pendiente |
| Seguridad | Verde | SEC-3 y SEC-4 implementados; SEC-2 (algoritmo JWT explícito) pendiente |
| Robustez / Observabilidad | Amarillo | Sin timeouts en Firestore (ROB-1); sin logging estructurado (ROB-2); sin health check (ROB-4); await innecesario eliminado (ROB-3 resuelto) |
| Configuración de producción | Verde | Validación de env al startup implementada (CFG-1); firestore.indexes.json creado (CFG-2); engines.node corregido (CFG-4); CFG-3 (min_instances) pendiente de evaluación |
| Deuda técnica relevante | Verde | Dead code eliminado (DT-2, DT-3, DT-5); runbook de sync creado (DT-1); sync no-atómico Group/User documentado y aceptado para v3 |

**Veredicto general: CONDICIONAL.** Los bloqueantes y gaps de alta prioridad están resueltos. Quedan 5 ítems de media prioridad sin spec (SEC-2, GAP-3, ROB-2, ROB-4, CFG-3) y 1 ítem de alta robustez sin spec (ROB-1 — timeouts Firestore). El sistema puede desplegarse en producción con tráfico controlado; los ítems pendientes deben resolverse en el primer sprint post-lanzamiento.

---

## 2. Gaps funcionales

### GAP-1 — `GET /api/v1/redirects/:id` no verifica ownership ni permisos

**Archivo:** `src/api/redirect/routes/redirect.route.api.js`, líneas 55–70  
**Severidad:** Alta

El handler de `GET /:id` llama `redirectServicieApi.findOne(id)` y devuelve el documento sin ninguna verificación de acceso. Cualquier usuario autenticado puede leer el redirect de otro usuario si conoce su ID de Firestore.

El spec (Fase 3, ítem 3.3 del diagnóstico anterior) marcó esto como **Alta prioridad**. No fue incluido en los Bloques 1–4. El `GET /` filtra correctamente por `owner` o `permission`; `GET /:id` omite esa misma lógica.

**Comportamiento esperado:** El acceso debe concederse si:
- `req.user.email === redirect.owner`, O
- `req.user.groups` intersecta con algún `"read:{group}"` de `redirect.permission`, O
- `req.user.role === 'admin'`

**Fix requerido:**
```js
redirectRouterApi.get('/:id', validatorHandler(getRedirectSchema, 'params'), async (req, res, next) => {
  const { id } = req.params;
  try {
    const data = await redirectServicieApi.findOne(id);
    const readPermissions = req.user.groups.map(g => `read:${g}`);
    const canRead = req.user.role === 'admin'
      || data.owner === req.user.email
      || (data.permission || []).some(p => readPermissions.includes(p));
    if (!canRead) return next(boom.forbidden('Insufficient permissions'));
    res.status(200).json({ message: 'redirect retrieved', data });
  } catch (error) { next(error); }
});
```

---

### GAP-2 — `permission` en redirects no valida el formato de las entradas

**Archivo:** `src/api/redirect/schemas/redirect.schema.js`, línea 10  
**Severidad:** Media

`permission` está definido como `Joi.array().items(Joi.string())` — acepta cualquier string. El sistema asume que las entradas tienen el formato `"read:{group}"` para que `array-contains-any` funcione correctamente en Firestore. Un cliente puede enviar `permission: ["foo", "bar"]` y los valores se almacenan sin error pero nunca producirán coincidencias en queries.

**Fix requerido:**
```js
const permission = Joi.array().items(
  Joi.string().pattern(/^(read|edit|delete):[a-z0-9-]+$/)
);
```

---

### GAP-3 — `GET /api/v1/users` no valida los query params `offset` y `limit`

**Archivo:** `src/api/users/routes/user.route.api.js`, líneas 33–47  
**Severidad:** Baja

El handler de `GET /users` recibe `offset` y `limit` de `req.query` y los pasa directamente a `userService.find(null, { offset, limit })` sin validación Joi. Los otros recursos (`redirects`, `groups`) tienen `getXxxQuerySchema` con validación de tipos. Un valor como `limit=0` o `limit=abc` se pasa a Firestore sin sanitización. CrudService no parseInt los valores de usuario (a diferencia del handler de redirects, línea 41, que sí hace `parseInt(offset)`).

Este gap fue documentado en el plan de Bloque 4 como "fuera de alcance" pero es relevante para producción.

---

## 3. Seguridad

### SEC-1 — `GET /api/v1/redirects/:id` expone redirects privados (Alta)

Descrito en GAP-1. Un atacante autenticado que adivine o enumere IDs de Firestore puede leer redirects privados de otros usuarios. Los IDs de Firestore son UUIDs aleatorios pero la superficie de ataque existe mientras el endpoint no tenga control de acceso.

**Recomendación:** Implementar la verificación de ownership/permission descrita en GAP-1 antes del despliegue.

---

### SEC-2 — JWT sin algoritmo explícito — HS256 por defecto (Media)

**Archivo:** `src/utils/auth/jwt.js`, líneas 10 y 20  
**Severidad:** Media

`jwt.sign()` y `jwt.verify()` no especifican algoritmo. `jsonwebtoken` usa `HS256` por defecto, que es seguro. Sin embargo, no especificarlo explícitamente significa que:
1. Un cambio de versión del paquete podría cambiar el default.
2. La ausencia de `algorithms: ['HS256']` en `verify()` deja abierta la posibilidad del ataque `alg:none` en implementaciones que no lo mitiguen internamente. `jsonwebtoken >= 9.0` rechaza `alg:none` por defecto, y la versión instalada es `^9.0.1` — el riesgo inmediato es bajo, pero la práctica defensiva es especificarlo explícitamente.

**Recomendación:**
```js
function sign(payload) {
  return jwt.sign(payload, config.jwt.jwtSecret, { expiresIn: config.jwt.jwtTtl, algorithm: 'HS256' });
}
function verify(token) {
  return jwt.verify(token, config.jwt.jwtSecret, { algorithms: ['HS256'] });
}
```

---

### SEC-3 — `JWT_SECRET` sin validación al startup — crash silencioso (Media)

**Archivo:** `src/config/index.js`, línea 21  
**Severidad:** Media

Si `JWT_SECRET` no está definido en el entorno, `config.jwt.jwtSecret` es `undefined`. `jwt.sign()` lanza `Error: secretOrPrivateKey must have a value` en runtime. El servidor arranca sin error; el primer intento de firmar un token (en el callback de OAuth2) crashea y responde 500. No hay validación de env al startup.

El mismo problema aplica a `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, y `GOOGLE_OAUTH_REDIRECT`.

**Recomendación:** Validar variables requeridas antes de que el servidor empiece a escuchar:
```js
// src/config/index.js o src/app.js
const REQUIRED_ENV = ['JWT_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_OAUTH_REDIRECT'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}
```

---

### SEC-4 — CORS: edge case con `CORS=*` en variable de entorno (Media)

**Archivo:** `src/config/index.js`, línea 6  
**Severidad:** Media

```js
cors: process.env.CORS ? process.env.CORS.split(',') : '*',
```

Si la variable de entorno `CORS` está definida y su valor es `*` (e.g., `CORS=*` en `app.yaml`), el resultado es `['*']` (array), que el paquete `cors` trata como string de origen literal — nunca coincide con ningún request. El wildcard funciona solo cuando `origin` es el string `'*'`, no el array `['*']`.

Si `CORS` no está definido, `config.cors = '*'` (string) y `cors({origin: '*'})` permite todos los orígenes — comportamiento correcto.

En producción con `app.yaml`, si se añade `CORS: "*"` como variable de entorno para documentar el comportamiento, el resultado es el bug. Si se omite, funciona correctamente. El riesgo es que no hay ninguna restricción de CORS en producción (todo permitido), y la configuración es frágil.

**Recomendación:** Arreglar la lógica de CORS y añadir restricción explícita en `app.yaml`:
```js
// src/config/index.js
cors: process.env.CORS === '*' || !process.env.CORS ? true : process.env.CORS.split(','),
```
Y en `app.yaml` documentar el origen del frontend cuando esté disponible.

---

### SEC-5 — Passport OAuth2 sin validación de `state` explícita (Baja)

**Archivo:** `src/api/auth/routes/auth.route.api.js`  
**Severidad:** Baja

`passport-google-oauth2` genera y valida el parámetro `state` automáticamente cuando se usa `session: false`. Sin sesión, el `state` se almacena en la cookie de sesión y se valida en el callback — pero `session: false` en el callback (`GET /google/callback`) deshabilita la sesión para esa request, no para la generación del `state`. El comportamiento depende de la versión de Passport.

Passport 0.6.x (versión instalada) maneja este flujo correctamente cuando no se usa `session: false` en `GET /google` (solo en el callback). La implementación actual usa `session: false` solo en el callback — correcto.

Sin embargo, la ausencia de un `state` personalizado significa que si Google o la red manipula el flujo, Passport puede no detectar ataques CSRF en el callback. El riesgo es bajo dado que `passport-google-oauth2` implementa protección de state.

**Recomendación:** Verificar en staging que el callback rechaza requests sin el parámetro `state` correcto.

---

### SEC-6 — Sin rate limiting en ningún endpoint (Informativo)

El spec documentó rate limiting como fuera de alcance de v3 con la justificación "añadir cuando el sistema esté autenticado (rate-limit por usuario, no por IP)". El sistema ahora está autenticado. Sin embargo, el endpoint `GET /api/v1/auth/google` inicia el flujo OAuth2 y puede generar redirects repetidos a Google — vector de abuso de servicio externo.

El catch-all de redirects (`GET /*`) también es público y sin rate limit — un atacante puede hacer miles de peticiones.

**Recomendación para v4:** `express-rate-limit` a nivel de router con diferenciación: endpoints auth (por IP) y API endpoints (por `req.user.email`).

---

### SEC-7 — Helmet con configuración por defecto (Informativo)

`app.use(helmet())` está montado correctamente. La configuración por defecto de Helmet 7.x aplica: `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Strict-Transport-Security`, `Content-Security-Policy` (básico). Para una aplicación API sin frontend propio, el CSP por defecto es conservador pero aceptable.

Sin embargo, `helmet()` por defecto no configura `Permissions-Policy`. Y `X-Powered-By: Express` es eliminado por Express cuando Helmet está activo — correcto.

No se requieren cambios para producción, pero hay margen para configuración más estricta.

---

## 4. Robustez / Observabilidad

### ROB-1 — Sin timeouts en operaciones Firestore (Alta para producción)

**Archivos:** `src/lib/firestore.js`, `src/utils/crud.service.js`  
**Severidad:** Alta

Todas las operaciones Firestore (`.get()`, `.add()`, `.update()`, `.delete()`, `.where().get()`) son Promises sin timeout configurado. Si Firestore está caído o lento, las requests cuelgan indefinidamente hasta que el cliente las cancela. En App Engine con `min_instances: 0`, una instancia fría enfrentando Firestore lento puede no responder nunca.

El SDK de `@google-cloud/firestore` no impone un timeout por defecto en queries. GAE impone un timeout de 60s por request, pero eso es tarde para dar feedback al usuario.

**Recomendación:** Envolver las operaciones críticas con `Promise.race` y un timeout configurable, o usar el `settings.timeout` del constructor de Firestore (disponible en el SDK).

---

### ROB-2 — `console.log` y `console.error` en producción (Media)

**Archivos:**
- `src/app.js`, líneas 38–41: `console.log` en startup
- `src/api/groups/services/group.service.api.js`, líneas 82 y 93: `console.error` en fallo de sync

Los `console.error` en `GroupService.update()` son los más relevantes: registran el error cuando falla la sincronización de `User.groups`, pero el error se re-lanza inmediatamente después. En producción, App Engine captura stdout/stderr en Cloud Logging, por lo que el logging funciona — pero el formato es texto plano, no JSON estructurado.

En particular, la situación de inconsistencia parcial (algunos usuarios actualizados, otros no) no genera ninguna alerta ni métrica. Si el sync falla a mitad de camino, el error se propaga al cliente como 500, pero no hay forma de saber qué usuarios quedaron inconsistentes.

**Recomendación:** Usar logging estructurado (JSON) para Cloud Logging desde el inicio. Mínimo: `{ severity, message, resource, error }`. Para el caso de inconsistencia parcial en el sync, loguear los emails afectados con suficiente detalle para una corrección manual.

---

### ROB-3 — `getAll()` en `CrudService` usa `await` sobre una `CollectionReference` (Baja)

**Archivo:** `src/utils/crud.service.js`, línea 38  
**Severidad:** Baja

```js
const fsCollection = await this.db.collection;
```

`this.db.collection` es una `CollectionReference` de Firestore, no una `Promise`. `await` sobre un valor no-thenable lo resuelve inmediatamente con el mismo valor — no hay error en runtime, pero el código es confuso y podría indicar una incomprensión del API.

Este bug fue identificado en el diagnóstico anterior (BUG-6). No se corrigió. No es bloqueante para producción.

---

### ROB-4 — Sin health check endpoint (Media)

`app.yaml` con `min_instances: 0` hace que las instancias arranquen desde cero. GAE envía un request de health check antes de enrutar tráfico. Sin un endpoint explícito `GET /_ah/health` o `GET /`, el health check usa el handler de root (que sirve HTML estático) — funciona, pero no verifica conectividad con Firestore.

**Recomendación:** Para v4, añadir `GET /_ah/health` que haga una lectura ligera a Firestore (e.g., `collection.limit(1).get()`) y responda 200 o 503 según el resultado.

---

### ROB-5 — El callback de OAuth2 no bloquea el login si el update de tokens falla

**Archivo:** `src/utils/auth/strategies/google-oauth2.strategy.js`, líneas 30–37  
**Severidad:** Informativo

El spec (Bloque 1, plan b1) documenta explícitamente: "El update de tokens en el callback de OAuth2 no bloquea el login. Si `userService.update()` falla, el error se swallowea y el login continúa."

Sin embargo, la implementación actual NO swallowea el error — si `userService.update()` falla, el error se propaga al `catch` externo y `done(error)` es llamado, lo que resulta en una respuesta de error al usuario. Esto es más seguro que swallowear, pero difiere de la intención documentada.

Si la actualización de tokens falla, el usuario no puede hacer login aunque sus credenciales sean válidas. En un sistema de alta disponibilidad esto es un problema; para v3 es aceptable.

---

## 5. Configuración de producción

### CFG-1 — `app.yaml` no declara las variables de entorno requeridas (Crítico)

**Archivo:** `app.yaml`  
**Severidad:** Crítica

El `app.yaml` actual solo define `NODE_ENV: "production"`. Las siguientes variables son requeridas en producción pero no están declaradas:

| Variable | Requerida | Impacto si falta |
|---|---|---|
| `JWT_SECRET` | Sí | El servidor arranca pero falla al primer login (crash en `jwt.sign()`) |
| `GOOGLE_CLIENT_ID` | Sí | Passport lanza error al registrar la strategy |
| `GOOGLE_CLIENT_SECRET` | Sí | Igual |
| `GOOGLE_OAUTH_REDIRECT` | Sí | El callback de OAuth2 usa URL incorrecta |
| `CORS` | No | Default: todos los orígenes permitidos (puede ser intencional) |
| `JWT_TTL` | No | Default `2h` — documentar la decisión |

Los secretos (`JWT_SECRET`, `GOOGLE_CLIENT_SECRET`) no deben estar en `app.yaml` como texto plano. El patrón correcto en App Engine es referenciarlos desde Google Secret Manager:
```yaml
env_variables:
  NODE_ENV: "production"
  GOOGLE_CLIENT_ID: "your-client-id"
  GOOGLE_OAUTH_REDIRECT: "https://1kg.me/api/v1/auth/google/callback"

# Secretos: referenciar desde Secret Manager o usar runtime config
```

Alternativamente, cargar secretos en runtime con `@google-cloud/secret-manager` al startup.

---

### CFG-2 — Sin índices Firestore para las queries compuestas (Crítico)

**Severidad:** Crítica

Las siguientes queries requieren índices compuestos en Firestore que no están declarados en ningún archivo de configuración:

#### Índice 1 — `GET /api/v1/redirects` (query con `Filter.or`)

```
Collection: redirects
Query: Filter.or(where('owner', '==', email), where('permission', 'array-contains-any', readPermissions))
       + optional orderBy('updated', 'desc')
```

`Filter.or` con campos distintos **requiere un índice compuesto de modo de colección** en Firestore. Sin el índice, la query falla en runtime con `FAILED_PRECONDITION: The query requires an index.`

El mensaje de error de Firestore incluye un enlace directo para crear el índice en la consola — pero esto no puede hacerse antes del despliegue si no se tiene la URL.

**Índice requerido (firestore.indexes.json):**
```json
{
  "indexes": [
    {
      "collectionGroup": "redirects",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "owner", "order": "ASCENDING" },
        { "fieldPath": "permission", "arrayConfig": "CONTAINS" },
        { "fieldPath": "updated", "order": "DESCENDING" }
      ]
    }
  ]
}
```

Nota: `Filter.or` con `array-contains-any` en Firestore SDK 7.x puede requerir un índice de "disjunción" que no siempre se puede pre-crear. Verificar en staging.

#### Índice 2 — `GET /api/v1/redirects` (query solo owner con orderBy)

```
Collection: redirects
Query: where('owner', '==', email) + orderBy('updated', 'desc')
```

Para usuarios sin grupos, la query es solo por `owner`. Si se añade `orderBy('updated')`, Firestore requiere un índice compuesto `(owner ASC, updated DESC)`.

**Índice requerido:**
```json
{
  "collectionGroup": "redirects",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "owner", "order": "ASCENDING" },
    { "fieldPath": "updated", "order": "DESCENDING" }
  ]
}
```

#### Índice 3 — `GET /api/v1/groups` (usuarios regulares)

```
Collection: groups
Query: where('slug', 'in', [slug1, slug2, ...]) + optional orderBy('updated', 'desc')
```

Si `orderBy` está presente, requiere índice compuesto.

---

### CFG-3 — `app.yaml`: `automatic_scaling.target_cpu_utilization` puede ser muy bajo

**Archivo:** `app.yaml`, línea 17  
**Severidad:** Baja

`target_cpu_utilization: 0.75` con `min_instances: 0` significa que GAE escala cuando el CPU supera el 75%. Con `min_instances: 0`, las instancias arrancan desde cero — cold start de Node.js 24 con Firestore puede tardar varios segundos. Para un URL shortener donde la latencia importa, esto puede causar picos de latencia.

Para producción inicial con tráfico bajo, considerar `min_instances: 1` para eliminar cold starts en la ruta del redirect catch-all.

---

### CFG-4 — `package.json` engines usa notación semver no válida

**Archivo:** `package.json`, línea implícita  
**Severidad:** Baja

```json
"engines": { "node": "24.x.x" }
```

La notación `24.x.x` no es semver estándar. La correcta sería `>=24.0.0` o `24.x`. No causa problemas en GAE (que usa el runtime especificado en `app.yaml`), pero puede causar warnings en `npm install`.

---

## 6. Deuda técnica relevante para producción

### DT-1 — Sync `Group.users` ↔ `User.groups` no es atómico (Alta)

**Archivo:** `src/api/groups/services/group.service.api.js`  
**Impacto:** Inconsistencia de datos entre la colección `groups` y `users` si cualquier write intermedio falla.

La estrategia fetch-first (D15) previene escrituras si usuarios del diff no existen, pero si `userService.update()` falla a mitad del loop, algunos usuarios tendrán `groups` actualizado y otros no. El documento del grupo sí se actualiza (es el último write). El estado resultante es inconsistente.

Para v3, el impacto es bajo dado el volumen esperado. El camino a v4 está documentado: Firestore batch write requiere refactorizar `FireStoreAdapter` para usar un singleton de `Firestore.Firestore()` en lugar de instanciarlo por colección.

**Acción recomendada antes de producción:** Documentar en el runbook que si un PATCH de grupo falla con 500, verificar manualmente la consistencia `User.groups` para los emails del diff.

---

### DT-2 — Dead code: `src/models/scope.model.js` y `src/models/groups.js` (Baja)

**Archivos:**
- `src/models/scope.model.js` — `Scope`, `OWNER_SCOPES`, `PERMISSIONS` no importados en ningún archivo de producción
- `src/models/groups.js` — `Group` legacy, reemplazado por `src/api/groups/models/group.model.api.js`

Ninguno causa problemas en producción, pero añaden confusión. El diagnóstico anterior (Fase 3, ítem 3.6) recomendó eliminar `Scope`/`OWNER_SCOPES`. Se difiere al mismo sprint de cleanup.

---

### DT-3 — `accesscontrol` instalado pero sin uso (Baja)

**Archivo:** `package.json`  
`"accesscontrol": "^2.2.1"` está en dependencias de producción pero ningún archivo en `src/` lo importa. Aumenta el bundle size sin aportar funcionalidad.

---

### DT-4 — `getAll()` en `CrudService` con `await` sobre `CollectionReference` (Baja)

Descrito en ROB-3. No es bloqueante pero introduce confusión sobre si `collection` es una Promise.

---

### DT-5 — `updateUserSchema` legacy exportado por compatibilidad sin consumers (Baja)

**Archivo:** `src/api/users/schemas/user.schema.js`, líneas 31–36  
Exportado con comentario "Retained for export compatibility — no active consumers after the schema split (R4)". Puede eliminarse en cleanup.

---

## 7. Checklist de producción

### Bloqueantes (deben resolverse antes del despliegue)

- [x] **CFG-1:** Configurar variables de entorno en producción (fuera de `app.yaml` para secretos; usar Secret Manager o variables de entorno de GAE configuradas por consola/CLI)
- [x] **CFG-1:** Validar al startup que `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT` están definidas; salir con `process.exit(1)` si faltan
- [x] **CFG-2:** Crear índices Firestore para `redirects` (Filter.or con owner/permission + orderBy) antes del primer despliegue con API activa
- [x] **CFG-2:** Verificar en staging que `GET /api/v1/redirects` con usuario multi-grupo no lanza `FAILED_PRECONDITION`

### Alta prioridad (resolver antes de exponer a usuarios)

- [x] **GAP-1:** Implementar verificación de ownership/permission en `GET /api/v1/redirects/:id`
- [x] **GAP-2:** Añadir validación de formato `^(read|edit|delete):[a-z0-9-]+$` al campo `permission` en `createRedirectSchema` y `updateRedirectSchema`
- [x] **SEC-3:** Validar `JWT_SECRET` al startup con mensaje de error claro — implementado como parte de CFG-1
- [x] **SEC-4:** Corregir lógica CORS para que `CORS=*` en env var resulte en `origin: true`, no `origin: ['*']`

### Media prioridad (resolver en el primer sprint post-lanzamiento)

- [ ] **SEC-2:** Especificar `algorithm: 'HS256'` explícitamente en `jwt.sign()` y `algorithms: ['HS256']` en `jwt.verify()`
- [ ] **GAP-3:** Añadir `getUsersQuerySchema` con validación Joi de `offset` y `limit` en `GET /api/v1/users`
- [ ] **ROB-2:** Reemplazar `console.error` por logging estructurado (JSON) compatible con Cloud Logging
- [ ] **ROB-4:** Añadir `GET /_ah/health` con verificación de conectividad Firestore
- [ ] **CFG-3:** Evaluar `min_instances: 1` en `app.yaml` para eliminar cold starts en la ruta del redirect

### Baja prioridad (cleanup técnico)

- [x] **ROB-3:** Eliminar `await` innecesario sobre `CollectionReference` en `CrudService.getAll()`, línea 38
- [x] **DT-2:** Eliminar `src/models/scope.model.js` y `src/models/groups.js` (dead code)
- [x] **DT-3:** Eliminar `accesscontrol` de `package.json`
- [x] **DT-5:** Eliminar `updateUserSchema` legacy de `user.schema.js`
- [x] **CFG-4:** Corregir `engines.node` en `package.json` de `"24.x.x"` a `">=24.0.0"`
- [x] **DT-1:** Documentar en runbook el procedimiento de verificación de consistencia `Group.users ↔ User.groups` post-fallo

---

## Apéndice — Índices Firestore recomendados

Archivo de referencia para crear los índices via `firebase deploy --only firestore:indexes` o manualmente en la consola de GCP:

```json
{
  "indexes": [
    {
      "collectionGroup": "redirects",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "owner", "order": "ASCENDING" },
        { "fieldPath": "updated", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "redirects",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "permission", "arrayConfig": "CONTAINS" },
        { "fieldPath": "updated", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "groups",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "slug", "order": "ASCENDING" },
        { "fieldPath": "updated", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

Nota: El índice para `Filter.or(owner, array-contains-any)` puede no ser pre-creable. Firestore generará el error con la URL exacta del índice requerido en el primer request que lo necesite desde staging. Capturar esa URL antes de producción.
