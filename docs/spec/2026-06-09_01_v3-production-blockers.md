# Spec técnico — v3: Bloqueantes de producción

**Fecha:** 2026-06-09
**Rama:** `v3-beta`
**Objetivo:** Resolver los ítems clasificados como Bloqueantes y Alta prioridad en el diagnóstico `2026-06-08_02_v3-production-readiness.md` antes de exponer la API a usuarios reales.

**Ítems cubiertos:**

| ID | Descripción |
|---|---|
| CFG-1 | Validar variables de entorno requeridas al startup |
| CFG-2 | Crear `firestore.indexes.json` con los índices necesarios |
| GAP-1 | Verificación de ownership/permission en `GET /api/v1/redirects/:id` |
| GAP-2 | Validación de formato en el campo `permission` |
| SEC-4 | Corrección del bug CORS con `CORS=*` en variable de entorno |

---

## Decisiones de diseño confirmadas

| # | Decisión |
|---|----------|
| D1 | La validación de env se ubica en `src/config/index.js`, al final del módulo, condicionada a `NODE_ENV !== 'test'`. Ver §1 para la justificación. |
| D2 | Se crea `firestore.indexes.json` con los tres índices pre-creables. El índice para `Filter.or` se documenta en un runbook inline porque no es pre-creable — debe capturarse desde el error de Firestore en staging. Ver §2. |
| D3 | El ownership check en `GET /:id` se implementa inline en el handler, siguiendo el mismo patrón ya establecido en `PATCH /:id` y `DELETE /:id`. No se extrae a función utilitaria en este sprint. Ver §3. |
| D4 | `CORS=*` (o `CORS` no definido) resulta en `origin: true`. El valor `true` instruye al paquete `cors` a reflejar el `Origin` del request — equivalente funcional al wildcard y compatible con credenciales. Ver §5. |

---

## §1 — CFG-1: Validación de variables de entorno al startup

### Contexto

`src/config/index.js` expone `config.jwt.jwtSecret`, `config.oauthGoogle.clientId`, etc. como `undefined` si las variables de entorno no están definidas. El servidor arranca sin error; el fallo ocurre en runtime al primer uso del secreto, produciendo un crash 500 sin mensaje diagnóstico claro.

**Decision D1 — Dónde poner la validación:**

Dos opciones:

| Opción | Pros | Contras |
|---|---|---|
| En `src/config/index.js` | La verificación ocurre en el mismo módulo que expone los valores; imposible usar `config` sin haber pasado la validación | El módulo no arranca ni en tests (se mitigaría con la guarda `NODE_ENV !== 'test'`, pero la guarda vive en el mismo módulo que la validación — puede verse como responsabilidad mezclada) |
| En `src/app.js` | Explícito en el bootstrap; los tests que importan `config` directamente no lo disparan | Requiere disciplina: si alguien añade un nuevo entry point sin la guarda, la validación se omite |

**Decisión: `src/config/index.js`**, al final del módulo, condicional a `NODE_ENV !== 'test'`. Justificación: el módulo `config` es el único punto de verdad para variables de entorno. Colocar la validación allí garantiza que cualquier entry point (incluyendo futuros scripts de migración o workers) siempre la dispare. La guarda de test es necesaria porque las variables de producción no están disponibles en la suite (`NODE_ENV=test` definido en `package.json`).

### Comportamiento esperado

- Si una o más de las variables requeridas no están definidas **y** `NODE_ENV !== 'test'`: imprimir el listado de variables faltantes a `stderr` y llamar `process.exit(1)`.
- En `NODE_ENV=test`: no validar — las variables de producción no están en el entorno de pruebas.
- El mensaje de error debe nombrar las variables faltantes para facilitar el diagnóstico en los logs de App Engine.

### Cambio exacto

**Archivo:** `src/config/index.js`

```js
require('dotenv').config();

module.exports = {
  dev: process.env.NODE_ENV != 'production',
  port: process.env.PORT || 3000,
  cors: process.env.CORS === '*' || !process.env.CORS ? true : process.env.CORS.split(','),
  version: process.env.npm_package_version,
  firestore: {
    collections: {
      redirects: 'redirects',
      users: 'users',
      groups: 'groups',
    },
  },
  oauthGoogle: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    oauthRedirect: process.env.GOOGLE_OAUTH_REDIRECT,
  },
  jwt: {
    jwtSecret: process.env.JWT_SECRET,
    jwtTtl: process.env.JWT_TTL || '2h',
  }
};

// Startup validation — skipped in test environment because production secrets
// are not available in CI. Any missing variable causes an immediate exit so
// the App Engine health-check fails before the server accepts traffic.
if (process.env.NODE_ENV !== 'test') {
  const REQUIRED_ENV = [
    'JWT_SECRET',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_OAUTH_REDIRECT',
  ];
  const missing = REQUIRED_ENV.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error(`[startup] Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}
```

Nota: el fix de CORS (`process.env.CORS === '*' || !process.env.CORS ? true : ...`) se incluye aquí porque ambos cambios afectan el mismo archivo y forman una unidad coherente. Ver §5 para la justificación de CORS de forma independiente.

### Archivos afectados

| Archivo | Tipo de cambio |
|---|---|
| `src/config/index.js` | Modificado |

---

## §2 — CFG-2: Índices Firestore

### Contexto

Las siguientes queries en producción requieren índices compuestos que Firestore no puede inferir automáticamente:

1. `GET /api/v1/redirects` (usuario con grupos): `Filter.or(owner == email, permission array-contains-any readPermissions)` + `orderBy('updated', 'desc')`
2. `GET /api/v1/redirects` (usuario sin grupos): `owner == email` + `orderBy('updated', 'desc')`
3. `GET /api/v1/groups` (admin o usuario): `slug in [slugs]` + `orderBy('updated', 'desc')` — solo si se añade `orderBy`; actualmente el handler no ordena, pero el schema soporta `orderBy`.

Sin estos índices, Firestore responde `FAILED_PRECONDITION: The query requires an index` en el primer request real.

**Decision D2 — `firestore.indexes.json` vs consola manual:**

El proyecto no usa Firebase CLI (`firebase.json` no existe, `firebase-tools` no está en `devDependencies`). El mecanismo disponible es:

- **Consola GCP / Firebase Console**: crear índices manualmente antes del despliegue.
- **`firebase deploy --only firestore:indexes`**: requiere instalar `firebase-tools` y crear `firebase.json`.

Para este sprint: crear `firestore.indexes.json` como archivo de referencia documental y para facilitar la creación manual. No se configura el deploy de Firebase CLI (fuera del alcance de este sprint; evaluar en el siguiente).

El índice para `Filter.or(owner, array-contains-any)` — que combina campos distintos en una disyunción — **no es pre-creable mediante `firestore.indexes.json`** porque Firestore genera su estructura interna al encontrar la query por primera vez. El procedimiento es:

1. Desplegar en staging.
2. Ejecutar `GET /api/v1/redirects` con un usuario que tenga al menos un grupo.
3. El error incluirá una URL directa a la consola de Firebase para crear el índice.
4. Crear el índice y esperar a que esté `Ready` (puede tardar varios minutos).
5. Repetir en producción.

### Índices pre-creables

Los índices 2 y 3 sí son pre-creables. El índice 1 (con `Filter.or`) se documenta en el runbook inline del archivo.

**Archivo nuevo:** `firestore.indexes.json` (en la raíz del proyecto)

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

**Runbook para el índice Filter.or (no pre-creable):**

El índice para `GET /api/v1/redirects` con usuario multi-grupo (`Filter.or`) debe crearse desde staging:

1. Desplegar `v3-beta` en un entorno de staging con la API activa.
2. Autenticarse y hacer `GET /api/v1/redirects` con un usuario que tenga al menos un grupo.
3. Si Firestore responde `FAILED_PRECONDITION`, el mensaje incluye una URL del tipo: `https://console.firebase.google.com/project/.../database/firestore/indexes?create_composite=...`
4. Abrir la URL, crear el índice, esperar estado `Ready`.
5. Repetir el request para confirmar que funciona.
6. Documentar el índice resultante en `firestore.indexes.json` para referencia futura.

### Archivos afectados

| Archivo | Tipo de cambio |
|---|---|
| `firestore.indexes.json` | Nuevo |

---

## §3 — GAP-1: Ownership check en `GET /api/v1/redirects/:id`

### Contexto

El handler actual recupera cualquier documento de Firestore sin verificar si el usuario tiene acceso. La lógica correcta es idéntica a la que `GET /` aplica al filtrar la lista: un documento es legible si el solicitante es el `owner`, o pertenece a un grupo con permiso `read:{group}`, o es admin.

`PATCH /:id` y `DELETE /:id` ya implementan un check de ownership inline con el patrón:

```js
const existing = await redirectServicieApi.findOne(id);
if (req.user.role !== 'admin' && existing.owner !== req.user.email) {
  return next(boom.forbidden('...'));
}
```

**Decision D3 — Inline vs función utilitaria:**

Los checks en `PATCH` y `DELETE` solo verifican ownership (`owner === email`). El check de `GET` requiere verificar también los permisos de grupo (`permission.includes('read:{group}')`). Las tres condiciones difieren lo suficiente para que una función utilitaria genérica (`canAccess(user, redirect, scope)`) sea apropiada a largo plazo, pero introduciría una abstracción nueva en un sprint de corrección de bugs.

**Decisión: inline en el handler**, siguiendo el patrón existente de `PATCH` y `DELETE`. El check de `GET` se añade con las tres condiciones. Si en un sprint futuro se detecta triplicación (los tres checks divergen), se extrae a un utilitario en `src/api/redirect/helpers/` o en el propio servicio.

### Comportamiento esperado

`GET /api/v1/redirects/:id` devuelve 200 si:
- `req.user.role === 'admin'`, O
- `redirect.owner === req.user.email`, O
- al menos una entrada de `redirect.permission` coincide con `read:{group}` para algún grupo del usuario.

En cualquier otro caso: 403 Forbidden con el mensaje `'Insufficient permissions'`.

El 404 del servicio (documento no encontrado) sigue propagándose normalmente a través de `next(error)`.

### Cambio exacto

**Archivo:** `src/api/redirect/routes/redirect.route.api.js`

Reemplazar el handler de `GET /:id` (líneas 55–70):

```js
redirectRouterApi.get(
  '/:id',
  validatorHandler(getRedirectSchema, 'params'),
  async (req, res, next) => {
    const { id } = req.params;
    try {
      const data = await redirectServicieApi.findOne(id);
      const readPermissions = req.user.groups.map(g => `read:${g}`);
      const canRead =
        req.user.role === 'admin' ||
        data.owner === req.user.email ||
        (data.permission || []).some(p => readPermissions.includes(p));
      if (!canRead) return next(boom.forbidden('Insufficient permissions'));
      res.status(200).json({
        message: 'redirect retrieved',
        data,
      });
    } catch (error) {
      next(error);
    }
  },
);
```

### Archivos afectados

| Archivo | Tipo de cambio |
|---|---|
| `src/api/redirect/routes/redirect.route.api.js` | Modificado |

---

## §4 — GAP-2: Validación de formato del campo `permission`

### Contexto

`permission` está declarado en el schema como `Joi.array().items(Joi.string())`, que acepta cualquier string. Las queries de Firestore asumen que las entradas tienen el formato `"read:{group}"` (o `"edit:{group}"`, `"delete:{group}"`). Un cliente puede enviar `["foo", "bar"]` — los valores se persisten en Firestore y nunca producen coincidencias en queries, causando confusión silenciosa.

El formato válido es `{scope}:{slug}` donde:
- `scope` ∈ `{ read, edit, delete }` (definidos en `src/models/scope.model.js`)
- `slug` es un identificador de grupo: `[a-z0-9-]+`

### Comportamiento esperado

POST y PATCH con `permission` que no cumple el patrón `^(read|edit|delete):[a-z0-9-]+$` reciben 400 Bad Request (respuesta estándar de `validatorHandler` ante fallo Joi).

### Cambio exacto

**Archivo:** `src/api/redirect/schemas/redirect.schema.js`

Reemplazar la línea 10:

```js
// Antes:
const permission = Joi.array().items(Joi.string());

// Después:
const permission = Joi.array().items(
  Joi.string().pattern(/^(read|edit|delete):[a-z0-9-]+$/)
);
```

El cambio afecta a `createRedirectSchema` y `updateRedirectSchema` simultáneamente porque ambos referencian la variable `permission` definida en el scope del módulo.

### Archivos afectados

| Archivo | Tipo de cambio |
|---|---|
| `src/api/redirect/schemas/redirect.schema.js` | Modificado |

---

## §5 — SEC-4: Corrección del bug CORS

### Contexto

La lógica actual en `src/config/index.js`:

```js
cors: process.env.CORS ? process.env.CORS.split(',') : '*',
```

Si `CORS=*` está definido en el entorno (incluyendo un `app.yaml` que lo declare para documentar el comportamiento), el resultado es `['*']`. El paquete `cors` recibe `origin: ['*']` — un array con el string literal `'*'` — y lo trata como una lista de orígenes permitidos. Ningún `Origin` del mundo coincide con `'*'` como string de origen, por lo que todas las requests CORS fallan silenciosamente.

**Decision D4 — `origin: true` como valor del wildcard:**

El paquete `cors` acepta tres formas para "permitir todos los orígenes":
- `origin: '*'` — string; añade `Access-Control-Allow-Origin: *`; incompatible con `credentials: true`.
- `origin: true` — refleja el `Origin` del request; compatible con credenciales; funcionalmente equivalente a `*` cuando no se usa `credentials`.
- `origin: false` — bloquea CORS.

`origin: true` es el valor correcto para producción porque es compatible con el flujo OAuth2 (que usa cookies de sesión en el callback, aunque solo si se usan credenciales en los requests). Para la API JWT, donde las credenciales viajan en el header `Authorization`, `origin: '*'` también funcionaría — pero `origin: true` es más correcto y sin desventajas.

### Comportamiento esperado

| Valor de `CORS` en env | Resultado en `config.cors` | Comportamiento |
|---|---|---|
| No definida | `true` | Todos los orígenes reflejados |
| `*` | `true` | Todos los orígenes reflejados |
| `https://1kg.me` | `['https://1kg.me']` | Solo ese origen |
| `https://1kg.me,https://app.1kg.me` | `['https://1kg.me', 'https://app.1kg.me']` | Solo esos orígenes |

### Cambio exacto

Este cambio ya está incluido en el bloque de código de §1. La línea relevante dentro del módulo `src/config/index.js`:

```js
// Antes:
cors: process.env.CORS ? process.env.CORS.split(',') : '*',

// Después:
cors: process.env.CORS === '*' || !process.env.CORS ? true : process.env.CORS.split(','),
```

No requiere cambios adicionales en `src/app.js` — `cors({ origin: config.cors })` ya está configurado correctamente; solo cambia el valor que recibe.

### Archivos afectados

| Archivo | Tipo de cambio |
|---|---|
| `src/config/index.js` | Modificado (mismo commit que CFG-1) |

---

## Archivos afectados — resumen

### Nuevos

| Archivo | Descripción |
|---|---|
| `firestore.indexes.json` | Índices compuestos pre-creables para Firestore |

### Modificados

| Archivo | Cambios |
|---|---|
| `src/config/index.js` | Fix CORS (`CORS=*` → `true`); validación de env al startup con `process.exit(1)` |
| `src/api/redirect/routes/redirect.route.api.js` | Ownership/permission check en `GET /:id` |
| `src/api/redirect/schemas/redirect.schema.js` | Patrón de validación en campo `permission` |

---

## Fuera de alcance de este spec

Los siguientes ítems del diagnóstico quedan diferidos al primer sprint post-lanzamiento (media y baja prioridad):

- **SEC-2**: Especificar `algorithm: 'HS256'` explícitamente en `jwt.sign()` / `jwt.verify()`.
- **GAP-3**: Añadir `getUsersQuerySchema` con validación de `offset` y `limit` en `GET /api/v1/users`.
- **ROB-1**: Timeouts en operaciones Firestore.
- **ROB-2**: Logging estructurado JSON para Cloud Logging.
- **ROB-3**: Eliminar `await` sobre `CollectionReference` en `CrudService.getAll()`.
- **ROB-4**: Health check endpoint `GET /_ah/health`.
- **CFG-3**: Evaluar `min_instances: 1` para eliminar cold starts.
- **CFG-4**: Corregir `engines.node` en `package.json`.
- **DT-1 al DT-5**: Cleanup técnico (dead code, sync no-atómico).
- **CFG-1 (secretos en producción)**: La gestión de secretos en `app.yaml` vs Secret Manager es una decisión de operaciones que no requiere cambio de código — se documenta en el runbook de despliegue.

---

## Orden de implementación recomendado

Cada ítem sigue el ciclo `[feat] → [test] → [docs]`:

1. **CFG-1 + SEC-4** (mismo archivo `src/config/index.js`) — un único ciclo feat/test/docs porque los dos cambios son inseparables en el mismo módulo.
2. **GAP-2** (`src/api/redirect/schemas/redirect.schema.js`) — cambio atómico, solo modifica el schema.
3. **GAP-1** (`src/api/redirect/routes/redirect.route.api.js`) — depende conceptualmente de GAP-2 (el campo `permission` ya estará validado al llegar al handler).
4. **CFG-2** (`firestore.indexes.json`) — archivo nuevo, sin dependencias de código; puede hacerse en cualquier momento del sprint.
