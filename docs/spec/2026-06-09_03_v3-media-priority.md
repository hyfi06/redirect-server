# Spec técnico — v3: Media prioridad

**Fecha:** 2026-06-09  
**Rama:** `v3-beta`  
**Objetivo:** Resolver los ítems clasificados como Media prioridad en el diagnóstico `2026-06-08_02_v3-production-readiness.md`. Estos ítems no bloquean el despliegue inicial pero deben resolverse antes de exponer el servicio a carga real.

**Estado:** Pendiente de implementación.

**Ítems cubiertos:**

| ID | Descripción | Estado |
|---|---|---|
| SEC-2 | Especificar `algorithm: 'HS256'` explícitamente en `jwt.sign()` y `jwt.verify()` | [ ] |
| GAP-3 | Añadir `getUsersQuerySchema` con validación Joi de `offset` y `limit` en `GET /api/v1/users` | [ ] |
| ROB-2 | Reemplazar `console.log`/`console.error` por logging estructurado JSON compatible con Cloud Logging | [ ] |
| ROB-4 | Añadir `GET /_ah/health` con verificación de conectividad Firestore | [ ] |

**Fuera de alcance de este spec:**
- **ROB-1** (timeouts en Firestore): requiere refactorizar `FireStoreAdapter` o `CrudService` con `Promise.race`; se difiere a v4.
- **CFG-3** (`min_instances: 1`): decisión de operaciones diferida a v4.

---

## §1 — SEC-2: Algoritmo HS256 explícito en JWT

### Contexto

`jwt.sign()` y `jwt.verify()` en `src/utils/auth/jwt.js` no especifican algoritmo. `jsonwebtoken` usa `HS256` por defecto y la versión instalada (`^9.0.1`) rechaza `alg:none` internamente, por lo que el riesgo inmediato es bajo. Sin embargo, no especificarlo:

1. Depende de un default implícito que un cambio de versión podría alterar.
2. No cumple la práctica defensiva de ser explícito sobre el algoritmo de firma.

### Cambio exacto

**Archivo:** `src/utils/auth/jwt.js`

```js
function sign(payload) {
  return jwt.sign(payload, config.jwt.jwtSecret, {
    expiresIn: config.jwt.jwtTtl,
    algorithm: 'HS256',
  });
}

function verify(token) {
  return jwt.verify(token, config.jwt.jwtSecret, { algorithms: ['HS256'] });
}
```

### Tests

Actualizar `src/utils/auth/__test__/jwt.test.js` para verificar que el token generado por `sign()` tiene header `alg: 'HS256'` y que `verify()` rechaza tokens firmados con otro algoritmo.

### Archivos afectados

| Archivo | Tipo de cambio |
|---|---|
| `src/utils/auth/jwt.js` | Modificado |

---

## §2 — GAP-3: Validación de query params en `GET /api/v1/users`

### Contexto

El handler `GET /api/v1/users` recibe `offset` y `limit` de `req.query` y los pasa directamente a `userService.find()` sin validación Joi ni conversión de tipo. Los demás recursos (`redirects`, `groups`) tienen sus respectivos `getXxxQuerySchema`. Valores como `limit=abc` o `limit=0` se pasan sin sanitización.

### Cambio exacto

**Archivo:** `src/api/users/schemas/user.schema.js` — añadir schema y exportarlo:

```js
const getUsersQuerySchema = Joi.object({
  offset: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1),
});
```

```js
module.exports = {
  idSchema,
  getUsersQuerySchema,   // añadir
  createUserSchema,
  updateUserByAdminSchema,
  updateUserSelfSchema,
  selectUpdateSchema,
};
```

**Archivo:** `src/api/users/routes/user.route.api.js` — añadir validación y `parseInt` en el handler `GET /`:

```js
const {
  idSchema,
  getUsersQuerySchema,   // añadir al import
  createUserSchema,
  selectUpdateSchema,
} = require('../schemas/user.schema');

// handler GET /
userRouterApi.get(
  '/',
  authorize('admin'),
  validatorHandler(getUsersQuerySchema, 'query'),   // añadir
  async (req, res, next) => {
    const { offset, limit } = req.query;
    try {
      const data = await userService.find(null, {
        offset: parseInt(offset),   // añadir parseInt, consistente con redirect handler
        limit: parseInt(limit),
      });
      res.status(200).json({
        message: 'users retrieved',
        data: data.map((u) => u.toPublic()),
      });
    } catch (error) {
      next(error);
    }
  },
);
```

### Tests

Actualizar `src/api/users/routes/__test__/user.route.api.test.js` con casos para `GET /`:
- `offset` y `limit` válidos → 200
- `offset=abc` (no numérico) → 400
- `limit=0` (menor que `min(1)`) → 400

### Archivos afectados

| Archivo | Tipo de cambio |
|---|---|
| `src/api/users/schemas/user.schema.js` | Modificado |
| `src/api/users/routes/user.route.api.js` | Modificado |

---

## §3 — ROB-2: Logging estructurado JSON para Cloud Logging

### Contexto

App Engine escribe stdout/stderr en Cloud Logging. El formato actual (texto plano de `console.log`/`console.error`) no permite filtrar por severidad ni extraer campos en Cloud Logging. El formato estructurado requiere JSON con campo `severity`.

Archivos con logging actual:
- `src/app.js` línea 38–42: `console.log` al startup
- `src/api/groups/services/group.service.api.js` líneas 82 y 93: `console.error` en fallo de sync

### Cambio exacto

**Archivo nuevo:** `src/utils/logger.js`

```js
function log(severity, message, data = {}) {
  if (process.env.NODE_ENV === 'production') {
    process.stdout.write(JSON.stringify({ severity, message, ...data }) + '\n');
  } else if (process.env.NODE_ENV !== 'test') {
    const extra = Object.keys(data).length ? data : '';
    console.log(`[${severity}] ${message}`, extra);
  }
}

module.exports = { log };
```

**Archivo:** `src/app.js` — reemplazar el bloque `app.listen`:

```js
const { log } = require('./utils/logger');

// ...

app.listen(config.port, function () {
  log('INFO', `Server listening on port ${config.port}`);
});
```

**Archivo:** `src/api/groups/services/group.service.api.js` — reemplazar los dos `console.error`:

```js
const { log } = require('../../../utils/logger');

// En el loop de added:
} catch (e) {
  log('ERROR', `Failed to add group ${current.slug} to user ${email}`, { error: e.message });
  throw e;
}

// En el loop de removed:
} catch (e) {
  log('ERROR', `Failed to remove group ${current.slug} from user ${email}`, { error: e.message });
  throw e;
}
```

### Tests

Añadir tests en `src/utils/__test__/logger.test.js`:
- En `NODE_ENV=production`: escribe JSON con campos `severity` y `message` a `process.stdout`.
- En `NODE_ENV=development`: llama a `console.log` (no lanza).
- En `NODE_ENV=test`: no produce output.

### Archivos afectados

| Archivo | Tipo de cambio |
|---|---|
| `src/utils/logger.js` | Nuevo |
| `src/app.js` | Modificado |
| `src/api/groups/services/group.service.api.js` | Modificado |

---

## §4 — ROB-4: Health check endpoint `GET /_ah/health`

### Contexto

App Engine envía requests a `GET /_ah/health` antes de enrutar tráfico a una instancia. Sin un handler explícito, el request cae en el catch-all `redirectRoute` que intenta buscar el path `/_ah/health` en Firestore — siempre 404. Esto no impide el arranque (GAE acepta 404 como "healthy") pero no verifica conectividad real con Firestore.

Un health check real debe responder 200 solo si Firestore responde, y 503 si no. Así, si el servicio arranca pero Firestore está caído, GAE detiene el enrutamiento de tráfico a la instancia afectada.

### Decisión de diseño — ubicación del route

El handler se registra en un nuevo `src/routes/health.js` y se monta en `src/app.js` entre `apiV1` y `redirectRoute`. Esto mantiene `rootRouter` enfocado en archivos estáticos y la home page, y hace explícita la posición del health check antes del catch-all.

### Cambio exacto

**Archivo nuevo:** `src/routes/health.js`

```js
const FireStoreAdapter = require('../lib/firestore');
const config = require('../config');

const db = new FireStoreAdapter(config.firestore.collections.redirects);

function healthRouter(app) {
  app.get('/_ah/health', async (req, res) => {
    try {
      await db.collection.limit(1).get();
      res.status(200).json({ status: 'ok' });
    } catch (e) {
      res.status(503).json({ status: 'error', message: e.message });
    }
  });
}

module.exports = healthRouter;
```

**Archivo:** `src/app.js` — registrar entre `apiV1` y `redirectRoute`:

```js
const healthRouter = require('./routes/health');

// ...

/* Routers */
rootRouter(app);
app.use(passport.initialize());
apiV1(app);
healthRouter(app);   // añadir aquí
redirectRoute(app);
```

### Tests

Añadir `src/routes/__test__/health.route.test.js`:
- Firestore responde sin error → 200 `{ status: 'ok' }`
- Firestore lanza error → 503 `{ status: 'error', message: '...' }`

Mockear `FireStoreAdapter` siguiendo el patrón de los tests de redirect route.

### Archivos afectados

| Archivo | Tipo de cambio |
|---|---|
| `src/routes/health.js` | Nuevo |
| `src/app.js` | Modificado |

---

## Archivos afectados — resumen

### Nuevos

| Archivo | Descripción |
|---|---|
| `src/utils/logger.js` | Logger estructurado JSON para Cloud Logging |
| `src/routes/health.js` | Health check endpoint `GET /_ah/health` |

### Modificados

| Archivo | Cambios |
|---|---|
| `src/utils/auth/jwt.js` | `algorithm: 'HS256'` en `sign()`, `algorithms: ['HS256']` en `verify()` |
| `src/api/users/schemas/user.schema.js` | Añadir `getUsersQuerySchema` |
| `src/api/users/routes/user.route.api.js` | Añadir `validatorHandler(getUsersQuerySchema, 'query')` + `parseInt` |
| `src/api/groups/services/group.service.api.js` | Reemplazar `console.error` con `log('ERROR', ...)` |
| `src/app.js` | Reemplazar `console.log` con `log('INFO', ...)`, registrar `healthRouter` |
---

## Orden de implementación

```
1. [fix]   SEC-2    src/utils/auth/jwt.js
   [test]           src/utils/auth/__test__/jwt.test.js
   [docs]           checkbox spec

2. [feat]  GAP-3    src/api/users/schemas/user.schema.js
                    src/api/users/routes/user.route.api.js
   [test]           src/api/users/routes/__test__/user.route.api.test.js
   [docs]           checkbox spec

3. [feat]  ROB-2    src/utils/logger.js (nuevo)
                    src/app.js
                    src/api/groups/services/group.service.api.js
   [test]           src/utils/__test__/logger.test.js (nuevo)
   [docs]           checkbox spec

4. [feat]  ROB-4    src/routes/health.js (nuevo)
                    src/app.js
   [test]           src/routes/__test__/health.route.test.js (nuevo)
   [docs]           checkbox spec
```

Las unidades 1 y 2 son independientes. Las unidades 3 y 4 comparten `src/app.js` — implementarlas en orden para evitar conflictos de edición.

---

## Verificación final

```bash
npm test   # 498+ tests, sin regresiones
```
