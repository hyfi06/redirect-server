# Spec técnico — v3: API de redirects con autenticación

**Fecha:** 2026-06-05  
**Objetivo:** Exponer una API funcional y segura para registrar redirects, con autenticación Google OAuth2, control de acceso por ownership y validación de namespace de paths por grupo.

---

## Decisiones de diseño confirmadas

| # | Decisión |
|---|----------|
| D1 | `User.groups` almacena slugs (no IDs). Se usa directamente en el JWT. |
| D2 | JWT TTL = 2h. Refresh token en `User.auth.refreshToken`. |
| D3 | Cambios de grupo toman efecto al expirar el token (próximo login). Efecto inmediato diferido a v4. |
| D4 | Rutas auth bajo `/api/v1/auth/` — nunca en root (el catch-all `GET /*` las interceptaría). |
| D5 | POST redirect recibe `group` + `path` separados; el servidor construye `fullPath = group ? \`/${group}/${path}\` : \`/${path}\``. El `fullPath` siempre lleva `/` inicial porque el catch-all usa `req.path` que Express siempre entrega con `/`. Se almacena `fullPath` en el campo `path` de Firestore. No cambia el schema de Firestore ni `getByPath`. |
| D6 | Validación de namespace en el handler, no en Joi (el `role` viene de `req.user`, no del body). |
| D7 | `slug` de grupo es inmutable tras la creación — ningún `PATCH` puede modificarlo. |
| D8 | `PATCH /api/v1/users/:id` tiene dos schemas según rol: admin puede cambiar `groups` y `role`; el propio usuario solo puede cambiar `firstName` y `lastName`. |
| D9 | `authorize(roles)` como middleware factory — encapsula la lógica de rol (patrón equivalente a `validatorHandler`). |
| D10 | GET /redirects usa `array-contains-any` para soportar usuarios en múltiples grupos. Si el SDK no soporta `array-contains-any` dentro de `Filter.or`, fallback: filtrar por primer grupo solamente (documentado como limitación). |
| D11 | El campo `path` en POST recibe el sub-segmento sin `/` inicial (`"seminar"`, `"eventos/2026"`). El servidor construye el `fullPath` con el `/` y el prefijo de grupo. Si el cliente envía `/seminar` → 400 Bad Request. Schema: `Joi.string().pattern(/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/)`. Normalización silenciosa descartada: fallar con 400 explícito es preferible a silenciar inconsistencias (recomendación software-architect). |
| D16 | **`GET /users` es admin-only.** Acceso restringido a `authorize('admin')`. Razón: el endpoint expone emails, roles y membresía de grupos completa. No hay caso de uso legítimo para un usuario regular en v3. Una apertura futura requiere un endpoint dedicado con proyección reducida (sin `role` ni `groups`). |
| D17 | **`GET /users/:id` es admin-only; usuarios regulares usan `GET /me`.** No se implementa ownership check en `/:id` — la separación de responsabilidades es más limpia: `/:id` es exclusivo de admins, `/me` es el endpoint del usuario autenticado. |
| D18 | **`PATCH /users/:id`: validación inline con `selectUpdateSchema(role)`.** El schema de update varía por rol en tiempo de ejecución, por lo que `validatorHandler` (schema fijo) no aplica. La función `selectUpdateSchema(role)` se define en `user.schema.js` para que la lógica de selección de schema viva junto a los schemas. La validación se ejecuta inline en el handler. |
| D19 | **`GET /me` hace lookup por `userId`.** `req.user.userId` → `userService.findOne(userId)`. Lookup por clave primaria (O(1)). Más eficiente y robusto ante futuros cambios de email que un lookup por `email`. |
| D20 | **Los constructores de `*.model.api.js` no aplican defaults a campos opcionales.** Los defaults pertenecen exclusivamente a los parsers de creación (`createXxxParser`). Aplicado en `Group` (Bloque 3) y en `User` (Bloque 4, fix de `role || 'user'`). Patrón establecido para futuros modelos. |

---

## Variables de entorno nuevas

| Variable | Descripción | Requerida |
|---|---|---|
| `JWT_SECRET` | Secret para firmar y verificar JWT | Sí |
| `JWT_TTL` | TTL del token (default `'2h'`) | No |

Añadir a `.env.example` y a `CLAUDE.md`.

---

## Bloque 1 — Autenticación

### 1.1 — Implementar `src/utils/auth/jwt.js`

**Estado actual:** Solo contiene `require('jsonwebtoken')`.

**Cambio:**

```js
// src/utils/auth/jwt.js
const jwt = require('jsonwebtoken');
const config = require('../../config');

function sign(payload) {
  return jwt.sign(payload, config.jwt.jwtSecret, { expiresIn: config.jwt.jwtTtl });
}

function verify(token) {
  return jwt.verify(token, config.jwt.jwtSecret); // throws JsonWebTokenError si inválido
}

module.exports = { sign, verify };
```

**Payload firmado:**
```js
{
  userId: string,   // Firestore document ID del usuario
  email: string,
  role: string,     // 'user' | 'admin'
  groups: string[]  // slugs de los grupos del usuario
}
```

**`src/config/index.js` — añadir:**
```js
jwtSecret: process.env.JWT_SECRET,
jwtTtl: process.env.JWT_TTL || '2h',
```

---

### 1.2 — Completar `src/utils/auth/strategies/google-oauth2.strategy.js`

**Estado actual:** `done()` vacío.

**Cambio — lógica del callback:**

> `passReqToCallback: true` está activo — la firma del callback incluye `request` como primer argumento.

```js
// 404 tratado en el try interno para no capturar errores de update
async (request, accessToken, refreshToken, profile, done) => {
  try {
    const email = profile.emails[0].value;
    let user;
    try {
      user = await userService.getByEmail(email);
    } catch (error) {
      if (error.output?.statusCode === 404) {
        return done(null, false, { message: 'User not registered' });
      }
      throw error;
    }
    const updatedUser = new User({ ...user, ...user.auth, googleToken: accessToken, googleRefreshToken: refreshToken });
    const saved = await userService.update(updatedUser);
    return done(null, saved);
  } catch (error) {
    return done(error);
  }
}
```

---

### 1.3 — Crear `src/middleware/authenticate.middleware.js`

```js
const boom = require('@hapi/boom');
const { verify } = require('../utils/auth/jwt');

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next(boom.unauthorized('Missing token'));
  }
  try {
    req.user = verify(authHeader.slice(7));
    next();
  } catch {
    next(boom.unauthorized('Invalid token'));
  }
}

module.exports = { authenticate };
```

---

### 1.4 — Crear `src/middleware/authorize.middleware.js`

```js
const boom = require('@hapi/boom');

function authorize(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return next(boom.forbidden('Insufficient permissions'));
    }
    next();
  };
}

module.exports = { authorize };
```

**Uso:** `router.post('/', authenticate, authorize('admin'), handler)`

---

### 1.5 — Crear `src/api/auth/routes/auth.route.api.js`

```
GET  /api/v1/auth/google           → passport.authenticate('google', { scope: ['profile','email'] })
GET  /api/v1/auth/google/callback  → passport.authenticate, luego sign JWT y responder
```

**Respuesta del callback (200):**
```json
{
  "message": "login successful",
  "data": {
    "token": "<jwt>",
    "user": { "id": "...", "email": "...", "firstName": "...", "lastName": "...", "groups": [], "role": "user" }
  }
}
```

Si el usuario no está en Firestore → responder JSON (nunca redirigir — D4 previene rutas auth en root):
```json
{ "statusCode": 401, "error": "Unauthorized", "message": "User not registered" }
```

---

### 1.6 — Actualizar `src/app.js` y `src/api/index.js`

**`app.js`:** montar `passport.initialize()` antes de `apiV1`.

**`src/api/index.js`:** añadir:
```js
const { authRouterApi } = require('./auth/routes/auth.route.api');
router.use('/auth', authRouterApi);
```

---

## Bloque 2 — API de redirects protegida

### 2.1 — Aplicar `authenticate` a todas las rutas de redirects

```js
redirectRouterApi.use(authenticate);
```

Antes del primer `redirectRouterApi.get(...)`.

---

### 2.2 — Cambios en `src/api/redirect/schemas/redirect.schema.js`

**`createRedirectSchema` — reemplazar:**

```js
// group: slug del grupo bajo el cual se registra el path (requerido para no-admins)
// path: segmento(s) del path sin el prefijo del grupo (D11: sin "/" inicial — 400 explícito si lo tiene)
const createRedirectSchema = Joi.object({
  group: Joi.string().lowercase().pattern(/^[a-z0-9-]+$/),  // opcional en schema; requerido en handler para no-admins
  path: Joi.string().pattern(/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/).required(),
  url: url.required(),
  permission: permission,
  categories: categories,
});
```

Se elimina `owner` — nunca viene del cliente.

**`updateRedirectSchema` — eliminar `owner`:**
```js
const updateRedirectSchema = Joi.object({
  path: path,
  url: url,
  permission: permission,
  categories: categories,
});
```

**`getRedirectQuerySchema` — eliminar `owner` y `group` como requeridos:**
```js
const getRedirectQuerySchema = Joi.object({
  orderBy: orderBy,
  offset: offset,
  limit: limit,
});
```

---

### 2.3 — Cambios en `src/api/redirect/routes/redirect.route.api.js`

**POST `/`:**
```js
redirectRouterApi.post('/', validatorHandler(createRedirectSchema, 'body'), async (req, res, next) => {
  const { group, path, url, permission, categories } = req.body;

  // Namespace validation (no puede estar en Joi — role viene de req.user)
  if (req.user.role !== 'admin') {
    if (!group) return next(boom.forbidden('group is required for non-admin users'));
    if (!req.user.groups.includes(group)) return next(boom.forbidden('User does not belong to this group'));
  }

  const fullPath = group ? `/${group}/${path}` : `/${path}`;
  const redirect = new Redirect({ path: fullPath, url, permission, categories, owner: req.user.email });

  try {
    const data = await redirectServicieApi.create(redirect);
    res.status(201).json({ message: 'redirect created', data });
  } catch (error) {
    next(error);
  }
});
```

**GET `/`:**
```js
redirectRouterApi.get('/', validatorHandler(getRedirectQuerySchema, 'query'), async (req, res, next) => {
  const { orderBy, offset, limit } = req.query;
  const { email, groups } = req.user;

  const readPermissions = groups.map(g => `read:${g}`);
  const filter = readPermissions.length > 0
    ? Filter.or(
        Filter.where('owner', '==', email),
        Filter.where('permission', 'array-contains-any', readPermissions),
      )
    : Filter.where('owner', '==', email);

  try {
    const redirectArray = await redirectServicieApi.find([filter], { orderBy, offset: parseInt(offset), limit: parseInt(limit) });
    res.status(200).json({ message: 'redirects retrieved', data: redirectArray });
  } catch (error) {
    next(error);
  }
});
```

> **Nota SDK:** `array-contains-any` dentro de `Filter.or` requiere `@google-cloud/firestore >= 7.1`. Si la versión del SDK no lo soporta, usar solo el primer grupo (`readPermissions[0]`) como fallback temporal y documentar la limitación.

**PATCH `/:id` y DELETE `/:id` — añadir verificación de ownership:**
```js
// antes de ejecutar la operación:
const existing = await redirectServicieApi.findOne(id);
if (req.user.role !== 'admin' && existing.owner !== req.user.email) {
  return next(boom.forbidden('Only the owner or an admin can modify this redirect'));
}
```

---

## Bloque 3 — Decisiones de diseño

| # | Decisión |
|---|----------|
| D12 | **Inyección de `UserServices` en `GroupService` por constructor.** El router instancia `new GroupService(userService)`. Hace explícito el acoplamiento de dominio y facilita el refactor a `MembershipService` en v4 cambiando solo el sitio de composición. |
| D13 | **GET `/groups` filtra por rol.** Admin: `getAll()`. Usuario con grupos: `find(['slug', 'in', groups])`. Usuario sin grupos: `[]` directo — la query `where('slug', 'in', [])` lanza error del SDK antes de hacer ninguna llamada de red. Guard: `Array.isArray(req.user.groups) && req.user.groups.length > 0`. |
| D14 | **`slug` inmutable — verificación en handler PATCH antes de Joi.** `updateParser` elimina `slug`. Handler PATCH: `authorize('admin')` va antes del check de `slug`; un no-admin con `slug` en el body recibe 403, no 400. Si el admin envía `slug` en el body → `boom.badRequest('slug is immutable')` antes de la validación Joi inline. |
| D15 | **Sync `Group.users` ↔ `User.groups` no es atómico en v3.** Estrategia fetch-first: antes de cualquier write se hace fetch de todos los usuarios del diff (`added` y `removed`); si alguno lanza `boom.notFound` → 400 (`"User not found: email"`) y nada se escribe. Writes secuenciales con `await` (fail-fast). `super.update(group)` se ejecuta al final del sync. Batch writes se difieren a v4 — requieren refactor de `FireStoreAdapter` a singleton compartido (`new Firestore.Firestore()` se crea actualmente por colección). |

---

## Bloque 3 — CRUD de grupos

### Estructura de archivos nuevos

```
src/api/groups/
  models/group.model.api.js
  schemas/group.schema.js
  parsers/group.parser.api.js
  services/group.service.api.js
  routes/group.route.api.js
```

### Modelo `Group`

```js
class Group {
  constructor(data) {
    const { id, name, slug, users, created, updated } = data;
    this.id = id || null;
    this.name = name;
    this.slug = slug;                                        // URL-safe, inmutable tras creación
    this.users = users !== undefined ? users : undefined;   // undefined → cleanDocObject lo omite en PATCH; [] vacía el grupo
    if (created) this.created = created;
    if (updated) this.updated = updated;
  }
}
```

> `Group.users` es la fuente de autoridad de membresía. `User.groups` es la lista denormalizada en el usuario (slugs). Cuando un admin modifica `Group.users`, debe actualizar también `User.groups` en los usuarios afectados. Para v3, estas dos escrituras se realizan secuencialmente en `GroupService` — la atomicidad vía Firestore batch se difiere a v4 (D15). El campo `users` en el constructor preserva `undefined` cuando el body del PATCH no lo incluye, evitando borrar miembros accidentalmente (R6).

### Schemas Joi

```js
const createGroupSchema = Joi.object({
  name: Joi.string().required(),
  slug: Joi.string().lowercase().pattern(/^[a-z0-9-]+$/).required(),
  users: Joi.array().items(Joi.string().email()),
});

const updateGroupSchema = Joi.object({
  name: Joi.string(),
  users: Joi.array().items(Joi.string().email()),
  // slug: prohibido — inmutable
});
```

### `GroupService`

Extiende `CrudService`. Añade:

```js
async getBySlug(slug) {
  const query = this.db.collection.where('slug', '==', slug);
  const snapshot = await query.get();
  if (snapshot.empty) throw boom.notFound('Group not found');
  return this.docParser(snapshot.docs[0]);
}

async create(group) {
  // verificar unicidad de slug
  try { await this.getBySlug(group.slug); } catch (e) {
    if (e.output?.statusCode !== 404) throw e;
    return this.docParser(await this.db.create(this.createParser(group)));
  }
  throw boom.badRequest('Slug already taken');
}

async update(id, group) {
  // fetch-first: si group.users está presente, obtiene el grupo actual y calcula el diff
  // (added, removed); verifica que todos los emails del diff existen antes de escribir
  // actualiza User.groups secuencialmente (fail-fast); luego llama super.update(group)
}
```

### Rutas y contratos HTTP

Todas las rutas requieren `authenticate`. Las de escritura requieren `authorize('admin')`.

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| `GET` | `/api/v1/groups` | authenticate | Admins: todos los grupos. Usuarios: solo los suyos (`slug in req.user.groups`) |
| `GET` | `/api/v1/groups/:id` | authenticate | Admins: cualquiera. Usuarios: solo si pertenecen |
| `POST` | `/api/v1/groups` | authenticate + authorize('admin') | Crear grupo. Slug único. |
| `PATCH` | `/api/v1/groups/:id` | authenticate + authorize('admin') | Editar `name` y/o `users`. Slug inmutable. |
| `DELETE` | `/api/v1/groups/:id` | authenticate + authorize('admin') | Eliminar grupo. |

**POST `/api/v1/groups` — respuesta 201:**
```json
{ "message": "group created", "data": { "id": "...", "name": "Facultad de Ciencias", "slug": "fc", "users": [] } }
```

**PATCH `/api/v1/groups/:id` — intento de cambiar slug → 400:**
```json
{ "statusCode": 400, "error": "Bad Request", "message": "slug is immutable" }
```

### Registrar en `src/api/index.js`

```js
const { groupRouterApi } = require('./groups/routes/group.route.api');
router.use('/groups', groupRouterApi);
```

---

## Bloque 4 — API de usuarios completada

### 4.1 — Aplicar `authenticate` a todas las rutas de usuarios

```js
userRouterApi.use(authenticate);
```

### 4.2 — Restringir creación y eliminación a admins

```js
userRouterApi.post('/', authenticate, authorize('admin'), validatorHandler(...), handler);
userRouterApi.delete('/:id', authenticate, authorize('admin'), validatorHandler(...), handler);
```

### 4.3 — Split de `updateUserSchema` en dos schemas

**`src/api/users/schemas/user.schema.js`:**

```js
// Para admin: puede cambiar role y groups
const updateUserByAdminSchema = Joi.object({
  firstName: firstName,
  lastName: lastName,
  groups: groups,
  role: Joi.string().valid('user', 'admin'),
});

// Para el propio usuario: solo perfil
const updateUserSelfSchema = Joi.object({
  firstName: firstName,
  lastName: lastName,
});
```

**Handler PATCH:**
```js
userRouterApi.patch('/:id', validatorHandler(idSchema, 'params'), async (req, res, next) => {
  const { id } = req.params;
  const isAdmin = req.user.role === 'admin';

  // Admins may edit any user; regular users may only edit their own profile
  if (!isAdmin && req.user.userId !== id) return next(boom.forbidden('Cannot update another user'));

  // Admin can change role and groups; regular users can only change their own name
  const schema = selectUpdateSchema(req.user.role);
  const { error, value } = schema.validate(req.body, { abortEarly: false, allowUnknown: false });
  if (error) return next(boom.badRequest(error.message));

  const user = new User({ id, ...value });
  try {
    const data = await userService.update(user);
    res.status(200).json({ message: 'user updated', data: data.toPublic() });
  } catch (error) { next(error); }
});
```

### 4.4 — Nuevo endpoint `GET /api/v1/me`

```js
userRouterApi.get('/me', async (req, res, next) => {
  try {
    const user = await userService.findOne(req.user.userId);
    res.status(200).json({ message: 'profile retrieved', data: user.toPublic() });
  } catch (error) { next(error); }
});
```

> Montar antes de `GET /:id` para que Express no confunda `/me` con un parámetro.

---

## Resumen de archivos afectados

### Nuevos
```
src/utils/auth/jwt.js                          (implementar)
src/middleware/authenticate.middleware.js       (nuevo)
src/middleware/authorize.middleware.js          (nuevo)
src/api/auth/routes/auth.route.api.js          (nuevo)
src/api/groups/models/group.model.api.js       (nuevo)
src/api/groups/schemas/group.schema.js         (nuevo)
src/api/groups/parsers/group.parser.api.js     (nuevo)
src/api/groups/services/group.service.api.js   (nuevo)
src/api/groups/routes/group.route.api.js       (nuevo)
```

### Modificados
```
src/utils/auth/strategies/google-oauth2.strategy.js   (completar done())
src/config/index.js                                    (jwtSecret, jwtTtl)
src/app.js                                             (passport.initialize())
src/api/index.js                                       (montar auth y groups)
src/api/redirect/schemas/redirect.schema.js            (eliminar owner, añadir group)
src/api/redirect/routes/redirect.route.api.js          (namespace validation, ownership check)
src/api/users/schemas/user.schema.js                   (split updateSchema)
src/api/users/routes/user.route.api.js                 (authenticate, authorize, /me, PATCH split)
```

---

## Fuera de alcance v3 (documentado para versiones posteriores)

| Tema | Razón del diferimiento |
|------|----------------------|
| Setup/bootstrap endpoint | Los usuarios ya existen en Firestore. Proceso manual documentado. |
| Efecto inmediato de cambios de grupo | Requiere blacklist de JWT o token de corta duración + refresh. Para v3 el TTL de 2h es el mecanismo de propagación. |
| Atomicidad en sync `Group.users` / `User.groups` | Requiere Firestore batch writes. Implementar en GroupService v4. |
| API Keys para acceso programático | No hay demanda hasta tener el sistema base. |
| Enforcement de `edit:{group}` y `delete:{group}` | El formato de strings lo soporta; enforcement cuando haya casos de uso reales. |
| Rate limiting | Añadir cuando el sistema esté autenticado (rate-limit por usuario, no por IP). |
| Migración de tokens `auth` a subcolección Firestore | `toPublic()` mitiga el riesgo de exposición. |
| `array-contains-any` en multi-grupo (si SDK < 7.1) | Fallback: primer grupo del usuario. Documentar como limitación. |
