# Diagnóstico de arquitectura — Estado actual del proyecto

**Fecha:** 2026-06-04
**Contexto:** Retoma del proyecto v2 (rama `dev`) abandonado hace ~2 años. Objetivo: establecer una base sólida para continuar el desarrollo del frontend de administración.

---

## 1. Bugs reales

### BUG-1 — `validatorHandler` llama `next()` dos veces en error de validación
**Archivo:** `src/middleware/validator.handler.js:14`
**Severidad:** Alta

```js
if (error) {
  next(boom.badRequest(error));  // ← sin return
}
next();  // ← siempre se ejecuta
```

Cuando la validación falla, Express recibe dos llamadas a `next()`. Dependiendo del order de ejecución puede provocar que el route handler se ejecute de todas formas, o que se intente enviar la respuesta dos veces. El arreglo es una línea: `return next(boom.badRequest(error))`.

---

### BUG-2 — `UserServices.getByEmail` retorna `DocumentSnapshot` crudo
**Archivo:** `src/api/users/services/user.service.api.js:33`
**Severidad:** Alta

```js
return userSnap.docs[0];  // ← debería ser: return this.docParser(userSnap.docs[0])
```

`RedirectServiceApi.getByPath` hace correctamente `this.docParser(snapshot.docs[0])`. El consumidor de `getByEmail` (en particular la futura estrategia OAuth2) recibirá un objeto que no responde a la interfaz `User`.

---

### BUG-3 — Un `PATCH` parcial de usuario borra todos sus tokens de auth
**Archivo:** `src/api/users/parsers/user.parser.api.js`
**Severidad:** Crítica

Cuando se hace `PATCH /api/v1/users/:id` con solo `{ firstName: "John" }`, el constructor `User` inicializa `this.auth = { googleToken: undefined, ... }`. `cleanDocObject` debería eliminar los `undefined`, pero no lo hace correctamente (ver BUG-4). El objeto `auth: {}` se escribe a Firestore. Como Firestore `.update()` con campos nested reemplaza el mapa completo, **todos los tokens almacenados son borrados**. Bug de pérdida de datos.

---

### BUG-4 — `cleanDocObject` nunca elimina objetos vacíos (raíz de BUG-3)
**Archivo:** `src/utils/clean.data.utils.js:9`
**Severidad:** Crítica

```js
return value === undefined || value === {};  // ← value === {} SIEMPRE es false
```

La comparación `value === {}` usa igualdad referencial: nunca puede ser `true` para un literal `{}`. La función solo elimina valores `undefined`. El intento de limpiar objetos vacíos no funciona.

---

### BUG-5 — `DELETE /:id` responde 200 OK para documentos inexistentes
**Archivo:** `src/lib/firestore.js:70`
**Severidad:** Media

`FireStoreAdapter.delete()` llama `docRef.delete()` sin verificar existencia. Firestore no lanza error si el documento no existe. Resultado: `DELETE /api/v1/redirects/:id` con un id inventado retorna HTTP 200.

---

### BUG-6 — `getAll()` usa `await` sobre una `CollectionReference`
**Archivo:** `src/utils/crud.service.js:31`
**Severidad:** Baja

```js
const fsCollection = await this.db.collection;
```

Una `CollectionReference` no es una `Promise`. `await` en un no-Promise lo resuelve como sí mismo, no rompe nada, pero es código confuso.

---

### BUG-7 — Ordenamiento inconsistente entre `getAll()` y `find()`
**Archivo:** `src/utils/crud.service.js`
**Severidad:** Media

`getAll()` siempre aplica `.orderBy('updated', 'desc')`. `find()` con query no añade ningún `orderBy` por defecto: resultados en orden indeterminado. Los paginados con `offset` sobre resultados sin orden son no-deterministas.

---

## 2. Riesgos de seguridad

### SEC-1 — Enumeración total de datos (Crítico)
`GET /api/v1/redirects?owner=victim@email.com&group=anygroup` devuelve todos los redirects de cualquier usuario sin autenticación. No hay rate limiting ni protección de ningún tipo.

### SEC-2 — Suplantación de propietario en creación (Crítico)
`POST /api/v1/redirects` acepta `owner` en el body. Cualquiera puede crear redirects con `owner: "admin@company.com"`. Cuando se implemente auth, estos redirects aparecerán como propiedad de la víctima.

### SEC-3 — Modificación y borrado sin autorización (Crítico)
`PATCH` y `DELETE /api/v1/redirects/:id` no verifican que el caller sea el dueño. Cualquiera con el `id` puede modificar la URL de destino (vector de phishing) o borrar el redirect.

### SEC-4 — Tokens de autenticación expuestos en respuestas de API (Alto)
`GET /api/v1/users/:id` y `GET /api/v1/users/` devuelven el objeto `User` completo incluyendo `auth.googleToken`, `auth.googleRefreshToken`, `auth.refreshToken`, `auth.apiToken`.

### SEC-5 — CORS roto (Alto)
```js
cors({ origin: config.cors.split(',') })  // → cors({ origin: ['*'] })
```
El paquete `cors` con `origin` como array trata cada elemento como string de origen literal, no como wildcard. `'*'` nunca coincide con ningún origen real. El futuro frontend SPA estaría bloqueado por CORS en la configuración default.

### SEC-6 — Estrategia OAuth2 registrada pero no conectada (Informativo)
`passport.initialize()` no está montado en `app.js`. No hay rutas `/auth/google` ni `/auth/google/callback`. El archivo de strategy existe pero no tiene ningún efecto en runtime.

---

## 3. Problemas de diseño

### DIS-1 — `owner` y `group` como query params en lugar de extraerse del JWT
El schema de `GET /api/v1/redirects` requiere `owner` y `group` como query params obligatorios. Cuando se implemente auth, estos valores deben provenir del token JWT del caller, no del cliente.

### DIS-2 — `Scope` / `OWNER_SCOPES` definidos pero nunca usados
`src/models/scope.model.js` define un sistema de scopes con referencia a `/groups/owner`, pero no está conectado a ninguna lógica de permisos. El modelo de permisos real usa `permission: string[]` en `Redirect`. Son dos sistemas desconectados.

### DIS-3 — `Group` no tiene `CrudService` ni endpoints
La colección `groups` está en config y el modelo `Group` existe, pero no hay servicio ni ruta para administrar grupos. El frontend no puede crear, leer ni modificar grupos.

### DIS-4 — `accesscontrol` instalado pero sin usar
`package.json` declara `"accesscontrol": "^2.2.1"` pero ningún archivo en `src/` la importa.

### DIS-5 — Tokens de auth mezclados con datos de perfil en el modelo `User`
`user.auth.googleToken` se serializa junto con `firstName`, `lastName`, etc. Cualquier endpoint que retorne un usuario expone tokens de acceso.

### DIS-6 — Inconsistencia entre `package.json` y `app.yaml`
`package.json`: `"engines": { "node": "22.x.x" }` (notación no-válida en semver).
`app.yaml`: `runtime: nodejs24`. Son inconsistentes.

---

## 4. Análisis de decisiones de arquitectura

### Autenticación: ¿API Key + JWT es la combinación correcta?

Para este caso de uso (URL shortener con frontend de administración), la combinación correcta es **Google OAuth2 → JWT de sesión**. No implementar API Key + JWT como dos sistemas en paralelo desde el inicio.

Flujo correcto:
1. Usuario se autentica en el frontend vía Google OAuth2 (`/auth/google` → `/auth/google/callback`).
2. El callback verifica o crea el `User` en Firestore y firma un JWT con `{ userId, email, role, groups }`.
3. El frontend incluye el JWT en `Authorization: Bearer <token>`.
4. `authenticate.middleware.js` verifica el JWT y pone `req.user` en el request.
5. Los route handlers usan `req.user.email` como `owner` — nunca confían en el body del cliente.

No usar `passport.session()`: requeriría un store (Redis) que no tiene sentido en App Engine que escala a 0. El JWT sin estado es la opción correcta.

Las API Keys para acceso programático son una Fase 4 diferible.

### Modelo de permisos: `permission: string[]` con `"read:{group}"`

Es suficiente para el caso de uso actual. El array en Firestore permite `array-contains` en queries sin joins. El formato `"read:{group}"` es extensible a `"edit:{group}"` sin cambiar el schema.

Problemas actuales:
- Solo existe `read:{group}`. Los permisos `edit` y `delete` están definidos en `scope.model.js` pero sin enforcement.
- `Scope` y `OWNER_SCOPES` son un sistema huérfano que añade confusión.

Recomendación: mantener el array de strings, añadir validación del formato en Joi, y eliminar `Scope`/`OWNER_SCOPES`.

### Fachada `src/redirect/` vs `src/api/redirect/`

Los tres archivos re-export en `src/redirect/` (models, parsers, services) no aportan valor. El router de redirect puede importar directamente de `src/api/redirect/`. La separación que sí tiene valor es mantener el **router** de redirect en `src/redirect/routes/` como representación del "Surface 3" público.

### Modelo `User` con tokens en el objeto principal

Riesgo de diseño: cualquier serialización de `User` expone tokens. Solución inmediata sin migración de datos: añadir `toPublic()` al modelo y usarlo explícitamente en los handlers. La migración de tokens a subcolección Firestore se difiere.

---

## 5. Plan de trabajo priorizado

### Fase 0 — Fundamentos de seguridad (~3-4h) — ANTES de cualquier feature nuevo

| # | Tarea | Archivo | Esfuerzo | Rompe prod |
|---|-------|---------|---------|------------|
| 0.1 | `return` en `validatorHandler` al llamar `next(error)` | `src/middleware/validator.handler.js` | S | No |
| 0.2 | Corregir `cleanDocObject` para comparar por contenido | `src/utils/clean.data.utils.js` | S | No |
| 0.3 | Proteger `updateUserParser` del overwrite de `auth` en PATCH parcial | `src/api/users/parsers/user.parser.api.js` | S | No |
| 0.4 | `UserServices.getByEmail` debe retornar `this.docParser(snap.docs[0])` | `src/api/users/services/user.service.api.js` | S | No |
| 0.5 | Verificar existencia en `FireStoreAdapter.delete()` antes de borrar | `src/lib/firestore.js` | S | No |
| 0.6 | Añadir `toPublic()` a `User` y usarlo en los route handlers | `src/api/users/models/user.js`, `routes/` | M | No |
| 0.7 | Corregir CORS config | `src/app.js` o `src/config/index.js` | S | Depende de config en prod |

Corrección de CORS:
```js
app.use(cors({
  origin: config.cors === '*' ? true : config.cors.split(','),
}));
```

### Fase 1 — Implementar autenticación completa (~1-2 días, semana 1-2)

| # | Tarea | Archivo(s) | Esfuerzo |
|---|-------|-----------|---------|
| 1.1 | Completar callback de Google OAuth2 (lookup/create User, sign JWT) | `src/utils/auth/strategies/google-oauth2.strategy.js` | M |
| 1.2 | Implementar `jwt.js`: `sign(payload)` y `verify(token)` | `src/utils/auth/jwt.js` | S |
| 1.3 | Crear `authenticate.middleware.js` (verifica JWT, pone `req.user`) | `src/middleware/authenticate.middleware.js` (nuevo) | M |
| 1.4 | Crear rutas `/auth/google` y `/auth/google/callback` | `src/api/auth/routes/auth.route.js` (nuevo) | M |
| 1.5 | Montar `passport.initialize()` en `app.js` | `src/app.js` | S |
| 1.6 | Registrar `/auth` en `apiV1` | `src/api/index.js` | S |

JWT payload: `{ userId, email, role, groups }`. TTL configurable vía env var (sugerencia: `JWT_TTL=24h`).

### Fase 2 — Proteger la API (~4-6h, semana 2)

| # | Tarea | Archivo(s) | Esfuerzo | Breaking |
|---|-------|-----------|---------|---------|
| 2.1 | Añadir `authenticate` middleware a todas las rutas de `/api/v1/redirects` | `redirect.route.api.js` | S | No* |
| 2.2 | Añadir `authenticate` middleware a todas las rutas de `/api/v1/users` | `user.route.api.js` | S | No* |
| 2.3 | Remover `owner`/`group` de query params de GET `/redirects` → leer de `req.user` | `redirect.route.api.js`, `redirect.schema.js` | M | Breaking |
| 2.4 | Remover `owner` del body de POST `/redirects` → asignar de `req.user.email` | `redirect.route.api.js`, `redirect.schema.js` | M | Breaking |
| 2.5 | Verificar ownership en PATCH y DELETE de redirects | `redirect.route.api.js` | M | No |

*La API en `dev` no tiene contratos de producción que proteger.

### Fase 3 — Completar API para el frontend (~2-3 días, semanas 2-4)

| # | Tarea | Esfuerzo | Prioridad |
|---|-------|---------|-----------|
| 3.1 | CRUD de grupos `GET/POST/PATCH/DELETE /api/v1/groups` | M | Alta |
| 3.2 | Endpoint `GET /api/v1/me` (perfil del usuario autenticado) | S | Alta |
| 3.3 | Verificar permisos de lectura en `GET /api/v1/redirects/:id` | M | Alta |
| 3.4 | Eliminar `getAll()` de `CrudService` (código muerto) | S | Media |
| 3.5 | Eliminar los 3 archivos re-export de `src/redirect/` | S | Baja |
| 3.6 | Eliminar `Scope`/`OWNER_SCOPES` hasta que se implemente permisos completos | S | Baja |
| 3.7 | Sincronizar `package.json` engines con `app.yaml` runtime | S | Baja |

### Fase 4 — Diferir

| Tarea | Razón |
|-------|-------|
| API Keys para acceso programático | No hay demanda hasta que el sistema base funcione |
| Migrar tokens `auth` a subcolección Firestore | Requiere migración de datos en producción; `toPublic()` de Fase 0 mitiga el riesgo |
| Rate limiting | Añadir cuando el sistema esté autenticado (rate-limit por usuario, no por IP) |
| Permisos `edit:{group}` y `delete:{group}` | El formato string ya los soporta; enforcement en handlers cuando haya casos de uso |

---

## Resumen ejecutivo

```
Fase 0 — bugs + seguridad básica:  ~3-4h   → inmediato
Fase 1 — implementar auth:         ~1-2d   → semana 1-2
Fase 2 — proteger API:             ~4-6h   → semana 2
Fase 3 — completar API:            ~2-3d   → semanas 2-4
Fase 4 — diferir:                          → post-frontend v1
```

El frontend puede empezar a desarrollarse en paralelo con Fase 2-3, siempre que use tokens JWT desde el día uno y no dependa de los parámetros inseguros `owner`/`group` como query strings.
