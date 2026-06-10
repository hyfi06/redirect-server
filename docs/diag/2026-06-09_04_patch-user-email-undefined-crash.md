# Bug Report — `PATCH /api/v1/users/:id` crash por `email` undefined

**Fecha:** 2026-06-09
**Estado:** RESUELTO
**Severidad:** Alta — crash en producción, endpoint inutilizable

---

## 1. Descripción del fallo

Toda solicitud a `PATCH /api/v1/users/:id` termina con un `TypeError` no capturado que escapa al pipeline de errores antes de que el handler pueda invocar a `next(err)`.

**Mensaje de error exacto:**

```
TypeError: Cannot read properties of undefined (reading 'toLowerCase')
    at new User (src/api/users/models/user.js:33:22)
    at src/api/users/routes/user.route.api.js:102:17
```

**Comportamiento observado:** el cliente recibe una respuesta 500 genérica (`Internal Server Error`) en lugar del resultado esperado de la actualización.

---

## 2. Causa raíz

### Línea exacta del fallo

`src/api/users/models/user.js:33`:

```js
this.email = email.toLowerCase().trim();
```

El constructor de `User` llama `email.toLowerCase()` incondicionalmente. Si `email` es `undefined`, la llamada lanza `TypeError`.

### Por qué `email` llega `undefined`

El handler de `PATCH /:id` construye el modelo así (`user.route.api.js:102`):

```js
const user = new User({ id, ...value });
```

`value` es el resultado de validar `req.body` contra uno de los dos schemas de actualización:

- `updateUserByAdminSchema` — permite `firstName`, `lastName`, `role`, `groups`
- `updateUserSelfSchema` — permite `firstName`, `lastName`

Ninguno de los dos schemas incluye `email`. Esta es una decisión de diseño correcta: el email es inmutable después del registro. Como consecuencia, `value` nunca contiene `email`, y el spread `{ id, ...value }` pasa `email: undefined` al constructor.

---

## 3. Por qué los tests no lo detectaron

Los tests existentes de `PATCH /api/v1/users/:id` mockeaban `userService.update()` o el constructor de `User` a nivel de módulo. El mock interceptaba la llamada antes de que el constructor real se ejecutara, por lo que el crash en `user.js:33` nunca ocurrió durante los tests.

**Gap de cobertura específico:** no existe ningún test que instancie `User` directamente con un payload de actualización real (sin `email`) y verifique que el constructor no lanza. Un test de integración del handler que no mockee el modelo habría detectado este fallo.

---

## 4. Fix propuesto

**Archivo:** `src/api/users/routes/user.route.api.js`, línea 102

```js
// Antes:
const user = new User({ id, ...value });

// Después:
const user = new User({ id, email: req.user.email, ...value });
```

`req.user.email` está garantizado en este punto porque el middleware `authenticate` verifica el JWT y establece `req.user` con el payload `{ userId, email, role, groups }` antes de que cualquier handler de `/api/v1/users` se ejecute. Si el JWT es inválido o está ausente, `authenticate` ya habría rechazado la solicitud con 401.

El email proveniente del JWT es el del usuario autenticado. Para una solicitud de admin que edita a otro usuario, `req.user.email` es el email del admin, no del usuario editado. El constructor de `User` en este contexto solo usa `email` para normalización antes de pasarlo al `updateParser`, que a su vez descarta `email` (campo inmutable) al construir el payload de escritura a Firestore. Por tanto, pasar `req.user.email` es suficiente para evitar el crash sin afectar la lógica de negocio.

**Alternativa más robusta:** hacer `email` opcional en el constructor con un guard:

```js
this.email = email ? email.toLowerCase().trim() : undefined;
```

Esta alternativa aísla el fix en el modelo y elimina la dependencia del handler en `req.user.email`. Se recomienda como cambio complementario.

---

## 5. Archivos afectados

| Archivo | Rol |
|---|---|
| `src/api/users/routes/user.route.api.js` | Handler `PATCH /:id` — origen del crash (línea 102) |
| `src/api/users/models/user.js` | Constructor `User` — punto exacto donde falla (línea 33) |
| `src/api/users/routes/__test__/user.route.api.test.js` | Tests del handler — gap de cobertura identificado |

---

## 6. Decisión arquitectónica — 2026-06-10

Revisión por `software-architect`. Se evaluaron tres opciones:

| Opción | Cambio | Veredicto |
|---|---|---|
| A | Inyectar `email: req.user.email` en el handler (`user.route.api.js:102`) | **Descartada** |
| B | Guard en el constructor: `email ? email.toLowerCase().trim() : undefined` | **Elegida** |
| C | Optional chaining: `email?.toLowerCase?.().trim?.()` | **Descartada** |

### Por qué se descartó la Opción A

Introduce un bug silencioso de presentación: cuando un admin edita a otro usuario, `toPublic()` devuelve el email del **admin** en la respuesta JSON en lugar del email del usuario editado. Los datos en Firestore no se corrompen (el `updateParser` descarta `email` antes de escribir), pero la respuesta HTTP es incorrecta. Corregir el síntoma en el handler acopla ese handler a un detalle de implementación del constructor.

### Por qué se descartó la Opción C

`email?.toLowerCase?.().trim?.()` es funcionalmente equivalente a B, pero encadenar `.trim?.()` sugiere que `trim` podría no existir en un string, lo cual nunca es verdad. El ternario explícito comunica mejor la intención: "email puede no existir en este contexto".

### Por qué se eligió la Opción B

El contrato real del modelo es: **email es requerido para creación, opcional para actualización**. Ese contrato pertenece donde se define el objeto, no donde se usa. Aplicar el guard en el constructor:

- No afecta el flujo `POST /`: `createUserSchema` tiene `email.required()` — Joi rechaza la request con 400 antes de que el constructor se ejecute si falta el email.
- No afecta ningún otro callsite: `docParser`, `google-oauth2.strategy.js`, y `group.service.api.js` siempre reciben un objeto completo con `email`. El único callsite que llega al constructor sin `email` es `PATCH /:id`.
- Es el cambio mínimo en el lugar correcto: una línea en el modelo.

### Fix aprobado

```js
// src/api/users/models/user.js:33
// Antes:
this.email = email.toLowerCase().trim();

// Después:
this.email = email ? email.toLowerCase().trim() : undefined;
```

---

## 7. Resolución

- **Fix**: commit `228b447` — `[fix] make email optional in User constructor — guard against undefined`
- **Tests**: commit `5694f3e` — `[test] add regression tests for User constructor email guard`
- **Versión**: 3.0.1
- **Fecha de resolución**: 2026-06-10
