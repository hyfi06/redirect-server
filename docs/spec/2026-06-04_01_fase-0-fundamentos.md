# 2026-06-04 — 01 — Fase 0: Fundamentos — Especificación Técnica

Este documento especifica los siete bugs/cambios de la Fase 0 del plan de desarrollo. Cada sección parte del código fuente actual leído directamente, propone el cambio exacto y define los casos de prueba necesarios. La Fase 0 no añade funcionalidad nueva; cierra huecos que hacen que el código existente sea inseguro o incorrecto.

---

## 0.1 — `return` faltante en `validatorHandler` al llamar `next(error)`

### Diagnóstico

**Archivo:** `src/middleware/validator.handler.js`

```js
// CÓDIGO ACTUAL (líneas 14-17)
if (error) {
  next(boom.badRequest(error));
}
next();
```

Cuando la validación falla, el middleware llama a `next(boom.badRequest(error))` para pasar el error a la cadena de manejo de errores, pero **no retorna**. En consecuencia, la ejecución continúa y `next()` se invoca una segunda vez en el mismo ciclo de solicitud. Express procesa entonces la solicitud como si fuera válida, avanzando al handler siguiente antes de que el error pueda ser manejado. El resultado observable es que una petición inválida puede ejecutar el handler de negocio y, en casos de concurrencia o escrituras en streams, produce `Error: Cannot set headers after they are sent to the client`.

### Cambio propuesto

```diff
--- a/src/middleware/validator.handler.js
+++ b/src/middleware/validator.handler.js
@@ -13,7 +13,7 @@ function validatorHandler(schema, property) {
   const { error } = schema.validate(data, { abortEarly: false });
   if (error) {
-    next(boom.badRequest(error));
+    return next(boom.badRequest(error));
   }
   next();
```

**After:**

```js
function validatorHandler(schema, property) {
  return async (req, res, next) => {
    const data = req[property];
    const { error } = schema.validate(data, { abortEarly: false });
    if (error) {
      return next(boom.badRequest(error));
    }
    next();
  };
}
```

### Impacto

- **Rompe (positivamente):** cualquier test que asuma que el handler de negocio se ejecuta con datos inválidos.
- **Habilita:** comportamiento correcto del pipeline de validación en toda la API (afecta todos los endpoints que usan `validatorHandler`, es decir, todos los de `/api/v1/redirects` y `/api/v1/users`).
- **Sin breaking change de contrato HTTP:** los clientes ya recibían 400, pero el comportamiento interno era impredecible.

### Tests

Archivo: `src/middleware/__test__/validator.handler.test.js`

| Caso | Condición | Expectativa |
|------|-----------|-------------|
| schema válido | datos correctos | `next()` llamado una sola vez sin argumentos |
| schema inválido | datos que fallan Joi | `next(boom.badRequest(...))` llamado una vez; el handler de negocio NO se invoca |
| schema inválido doble-next | igual que el anterior | `next` total de llamadas = 1 (no 2) |

---

## 0.2 — `cleanDocObject` no detecta objetos vacíos

### Diagnóstico

**Archivo:** `src/utils/clean.data.utils.js`

```js
// CÓDIGO ACTUAL (línea 10)
return value === undefined || value === {};
```

En JavaScript, `value === {}` **siempre es `false`**. La comparación de igualdad estricta entre dos objetos compara referencias, no contenido. Un literal `{}` en el lado derecho crea una nueva referencia en cada evaluación; ningún objeto existente jamás es `===` a ese literal.

Efecto: `cleanDocObject` sólo elimina claves con valor `undefined`. Las claves cuyo valor es `{}` (objeto vacío) nunca son limpiadas. Esto afecta directamente a `createUserParser` y `updateUserParser`, que dependen de esta función para limpiar el sub-objeto `auth` antes de escribir en Firestore.

La intención correcta es detectar si un objeto está vacío usando `Object.keys(value).length === 0`.

### Cambio propuesto

```diff
--- a/src/utils/clean.data.utils.js
+++ b/src/utils/clean.data.utils.js
@@ -7,7 +7,10 @@ function cleanDocObject(data) {
   Object.entries(data)
     .filter((entry) => {
       const [_, value] = entry;
-      return value === undefined || value === {};
+      return (
+        value === undefined ||
+        (value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)
+      );
     })
```

**After completo:**

```js
function cleanDocObject(data) {
  Object.entries(data)
    .filter(([_, value]) => {
      return (
        value === undefined ||
        (value !== null &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          Object.keys(value).length === 0)
      );
    })
    .forEach(([key]) => {
      delete data[key];
    });
  return data;
}
```

**Nota sobre Arrays:** un array vacío `[]` no debe eliminarse (Firestore los almacena correctamente y `permission: []` y `categories: []` son defaults legítimos en `createRedirectParser`). El guard `!Array.isArray(value)` preserva ese comportamiento.

### Impacto

- **Habilita:** `createUserParser` limpia correctamente un `auth: {}` antes de escribir en Firestore, evitando que se persista un objeto vacío que no aporta información.
- **Dependencia directa:** la tarea 0.3 depende de que esta función funcione correctamente; debe implementarse primero.
- Sin breaking change de contrato API.

### Tests

Archivo: `src/utils/__test__/clean.data.utils.test.js`

| Caso | Entrada | Salida esperada |
|------|---------|-----------------|
| valor `undefined` | `{ a: undefined, b: 1 }` | `{ b: 1 }` |
| objeto vacío `{}` | `{ auth: {}, name: 'x' }` | `{ name: 'x' }` |
| objeto no vacío | `{ auth: { token: 'abc' }, name: 'x' }` | sin cambio |
| array vacío | `{ tags: [], name: 'x' }` | sin cambio (arrays no se eliminan) |
| array no vacío | `{ groups: ['a'], name: 'x' }` | sin cambio |
| `null` | `{ a: null, b: 1 }` | sin cambio (`null` no es objeto vacío) |
| valor primitivo | `{ a: 0, b: false }` | sin cambio |

---

## 0.3 — `updateUserParser` sobrescribe `auth` en PATCH parcial

### Diagnóstico

**Archivo:** `src/api/users/parsers/user.parser.api.js`

```js
// CÓDIGO ACTUAL (líneas 45-52)
function updateUserParser(user) {
  const data = { ...user };
  deleteRegData(data);
  delete data.email;
  if (user.auth) cleanDocObject(user.auth);
  cleanDocObject(user);
  return data;
}
```

Hay tres problemas encadenados:

**Problema A — `cleanDocObject` muta `user`, no `data`.**
La línea `cleanDocObject(user)` opera sobre el objeto `user` original, pero `data` ya es una copia superficial (`{ ...user }`) tomada antes. Las claves `undefined` eliminadas de `user` no se reflejan en `data`.

**Problema B — Lógica de `auth` incorrecta con la corrección de 0.2.**
Con `cleanDocObject` funcionando, `if (user.auth) cleanDocObject(user.auth)` limpiará el objeto `user.auth` in-place (elimina tokens `undefined`). Pero `data.auth` es la misma referencia que `user.auth` (copia superficial), por lo que esto sí se refleja en `data`. Sin embargo, si `user.auth` es `{}` después de limpiar los `undefined`, debería eliminarse de `data` también, para no sobrescribir tokens existentes en Firestore con un objeto vacío.

**Problema C — Overwrite de `auth` en PATCH parcial.**
El `User` constructor siempre construye `this.auth`:

```js
// src/api/users/models/user.js líneas 38-43
this.auth = {
  googleToken: googleToken,
  googleRefreshToken,
  refreshToken,
  apiToken,
};
```

Cuando el cliente envía `PATCH /api/v1/users/:id` con sólo `{ firstName: "Juan" }`, el handler del route hace:

```js
const user = new User({ id, ...req.body });
```

Esto construye un `User` con `auth: { googleToken: undefined, googleRefreshToken: undefined, refreshToken: undefined, apiToken: undefined }`. El `updateUserParser` actual incluirá ese `auth` en `data`, y `CrudService.update` lo pasará a `FireStoreAdapter.update`, que lo escribirá en Firestore **sobrescribiendo los tokens reales del usuario**.

### Cambio propuesto

```diff
--- a/src/api/users/parsers/user.parser.api.js
+++ b/src/api/users/parsers/user.parser.api.js
@@ -45,9 +45,13 @@ function updateUserParser(user) {
   const data = { ...user };
   deleteRegData(data);
   delete data.email;
-  if (user.auth) cleanDocObject(user.auth);
-  cleanDocObject(user);
-  return data;
+  if (data.auth) {
+    cleanDocObject(data.auth);
+    if (Object.keys(data.auth).length === 0) {
+      delete data.auth;
+    }
+  }
+  cleanDocObject(data);
+  return data;
 }
```

**After completo:**

```js
function updateUserParser(user) {
  const data = { ...user };
  deleteRegData(data);
  delete data.email;
  if (data.auth) {
    cleanDocObject(data.auth);
    if (Object.keys(data.auth).length === 0) {
      delete data.auth;
    }
  }
  cleanDocObject(data);
  return data;
}
```

**Razonamiento:** se trabaja sobre `data` (la copia) en todo momento. Primero se limpia el sub-objeto `auth` de sus `undefined`; si queda vacío se elimina de `data` para no sobrescribir tokens existentes en Firestore. Luego `cleanDocObject(data)` elimina cualquier otro campo `undefined` del nivel raíz.

### Impacto

- **Corrige:** PATCH parcial que sólo actualiza `firstName`/`lastName`/`groups` ya no borra los tokens de autenticación del usuario.
- **Dependencia:** requiere que 0.2 esté implementado primero (de lo contrario `cleanDocObject` no detecta `{}`).
- Sin breaking change de contrato HTTP.

### Tests

Archivo: `src/api/users/parsers/__test__/user.parser.api.test.js`

| Caso | Entrada `user` | Expectativa sobre `data` retornado |
|------|----------------|------------------------------------|
| PATCH solo `firstName` | `{ firstName: 'Juan', auth: { googleToken: undefined, ... } }` | `auth` ausente en `data` |
| PATCH con token nuevo | `{ apiToken: 'xyz', auth: { apiToken: 'xyz', ... rest undefined } }` | `data.auth = { apiToken: 'xyz' }` |
| PATCH sin `auth` en body | `auth` completamente ausente | `auth` ausente en `data` |
| `id`, `created`, `email` siempre excluidos | cualquier user | `data` no contiene `id`, `created`, `email` |

---

## 0.4 — `UserServices.getByEmail` retorna `DocumentSnapshot` crudo

### Diagnóstico

**Archivo:** `src/api/users/services/user.service.api.js`

```js
// CÓDIGO ACTUAL (líneas 26-33)
async getByEmail(email) {
  const query = await this.db.collection.where('email', '==', email);
  const userSnap = await query.get();
  if (userSnap.empty) {
    throw boom.notFound('User not found');
  }
  return userSnap.docs[0];
}
```

**Problema A — `await` innecesario sobre `.where()`.**
`CollectionReference.where()` es síncrono y devuelve una `Query`. El `await` no hace daño pero es semánticamente incorrecto y confuso.

**Problema B — Retorna `DocumentSnapshot` sin parsear.**
El método retorna `userSnap.docs[0]` (un `Firestore.DocumentSnapshot`), no un modelo `User`. Cualquier llamador que espere un `User` (con propiedades `email`, `auth`, etc.) recibirá un objeto sin esas propiedades en el nivel raíz. Actualmente `getByEmail` sólo se llama desde `create()` para comprobar unicidad (y descarta el resultado), por lo que el bug no se ha manifestado aún. En cuanto se use para autenticación (OAuth2 strategy) el error será inmediato.

**Problema C — Uso incorrecto de `this.db.collection`.**
`CrudService` expone `this.db` (instancia de `FireStoreAdapter`) cuya propiedad `this.db.collection` es una `CollectionReference` de Firestore. La llamada en `RedirectServiceApi.getByPath` sigue el mismo patrón; es consistente, pero vale documentarlo.

### Cambio propuesto

```diff
--- a/src/api/users/services/user.service.api.js
+++ b/src/api/users/services/user.service.api.js
@@ -26,8 +26,8 @@ class UserServices extends CrudService {
   async getByEmail(email) {
-    const query = await this.db.collection.where('email', '==', email);
+    const query = this.db.collection.where('email', '==', email);
     const userSnap = await query.get();
     if (userSnap.empty) {
       throw boom.notFound('User not found');
     }
-    return userSnap.docs[0];
+    return this.docParser(userSnap.docs[0]);
   }
```

**After:**

```js
async getByEmail(email) {
  const query = this.db.collection.where('email', '==', email);
  const userSnap = await query.get();
  if (userSnap.empty) {
    throw boom.notFound('User not found');
  }
  return this.docParser(userSnap.docs[0]);
}
```

### Impacto

- **Habilita:** que la Google OAuth2 strategy (cuando se implemente) pueda llamar `getByEmail` y recibir un `User` completo con `id`, `auth`, `groups`, etc.
- **No rompe** `create()` porque sólo llama `getByEmail` para comprobar que lanza `boom.notFound`, e ignora el valor de retorno.
- Sin breaking change de contrato HTTP.

### Tests

Archivo: `src/api/users/services/__test__/user.service.api.test.js`

| Caso | Mock Firestore | Expectativa |
|------|----------------|-------------|
| email existe | snapshot no vacío con doc válido | retorna instancia de `User` con `id` y `email` correctos |
| email no existe | snapshot vacío | lanza `boom.notFound` |
| `.where()` no se llama con `await` | — | el query se construye síncronamente |

---

## 0.5 — `FireStoreAdapter.delete()` no verifica existencia previa

### Diagnóstico

**Archivo:** `src/lib/firestore.js`

```js
// CÓDIGO ACTUAL (líneas 70-74)
async delete(id) {
  const docRef = this.collection.doc(id);
  await docRef.delete();
  return id;
}
```

La API de Firestore SDK no lanza error cuando se llama a `docRef.delete()` sobre un documento inexistente — simplemente es una operación no-op silenciosa. El método retorna `id` aunque no haya borrado nada. El caller (`CrudService.delete` → handler `DELETE /:id`) responderá con `200 { data: id }` para un ID inexistente, violando la semántica REST (debería ser 404).

Los métodos `get()` y `update()` del mismo adaptador ya hacen esta comprobación (líneas 21-23 y 55-57 respectivamente). El patrón a seguir está establecido.

### Cambio propuesto

```diff
--- a/src/lib/firestore.js
+++ b/src/lib/firestore.js
@@ -70,6 +70,9 @@ class FireStoreAdapter {
   async delete(id) {
     const docRef = this.collection.doc(id);
+    if (!(await docRef.get()).exists) {
+      throw boom.notFound('Resource not found');
+    }
     await docRef.delete();
     return id;
   }
```

**After:**

```js
async delete(id) {
  const docRef = this.collection.doc(id);
  if (!(await docRef.get()).exists) {
    throw boom.notFound('Resource not found');
  }
  await docRef.delete();
  return id;
}
```

**Nota de coste:** esta corrección añade una lectura de Firestore por cada operación `DELETE`. Es el mismo coste que ya paga `update()`. Para la escala actual (0-3 instancias GAE) es aceptable y consistente.

### Impacto

- **Corrige:** `DELETE /api/v1/redirects/:id` y `DELETE /api/v1/users/:id` con ID inexistente ahora retornan 404 en lugar de 200.
- **Breaking change de comportamiento** (no de contrato formal, pero clientes que dependían del 200 silencioso deberán actualizarse).
- **Consistencia:** alinea `delete()` con `get()` y `update()`.

### Tests

Archivo: `src/lib/__test__/firestore.test.js`

| Caso | Condición | Expectativa |
|------|-----------|-------------|
| ID existente | doc existe en Firestore | retorna `id`, doc eliminado |
| ID inexistente | doc no existe | lanza `boom.notFound('Resource not found')` |
| Consistencia con `get` | mensaje de error idéntico | mismo string que en `get()` y `update()` |

---

## 0.6 — `User` expone tokens en respuestas JSON (`toPublic()` faltante)

### Diagnóstico

**Archivo:** `src/api/users/models/user.js` + `src/api/users/routes/user.route.api.js`

El modelo `User` almacena en `this.auth` los tokens de autenticación:

```js
// user.js líneas 38-43
this.auth = {
  googleToken: googleToken,
  googleRefreshToken,
  refreshToken,
  apiToken,
};
```

Los route handlers responden directamente con el objeto retornado por el servicio:

```js
// user.route.api.js líneas 19-22 (GET /)
res.status(200).json({
  message: 'users retrieved',
  data,           // array de User con auth.googleToken, auth.apiToken, etc.
});
```

`res.json()` llama a `JSON.stringify()` que serializa **todas** las propiedades enumerables del objeto, incluyendo `auth`. Todos los endpoints (`GET /`, `GET /:id`, `POST /`, `PATCH /:id`) filtran tokens de autenticación sensibles hacia cualquier cliente que pueda leer la API, que actualmente está completamente desprotegida.

### Cambio propuesto

**Paso 1 — Añadir `toPublic()` al modelo `User`:**

```diff
--- a/src/api/users/models/user.js
+++ b/src/api/users/models/user.js
@@ -62,6 +62,18 @@ class User {
     return [this.lastName, this.firstName]
       ...
   }
+
+  /**
+   * Returns a plain object safe for JSON responses (no auth tokens).
+   * @returns {Object}
+   */
+  toPublic() {
+    return {
+      id: this.id,
+      email: this.email,
+      firstName: this.firstName,
+      lastName: this.lastName,
+      groups: this.groups,
+      role: this.role,
+      created: this.created,
+      updated: this.updated,
+    };
+  }
 }
```

**Paso 2 — Usar `toPublic()` en los route handlers:**

```diff
--- a/src/api/users/routes/user.route.api.js
+++ b/src/api/users/routes/user.route.api.js
@@ -17,7 +17,7 @@ userRouterApi.get('/', async (req, res, next) => {
     const data = await userService.find(null, { offset, limit });
     res.status(200).json({
       message: 'users retrieved',
-      data,
+      data: data.map((u) => u.toPublic()),
     });
@@ -34,7 +34,7 @@ userRouterApi.get('/:id', ...
     const data = await userService.findOne(id);
     res.status(200).json({
       message: 'user retrieved',
-      data,
+      data: data.toPublic(),
     });
@@ -51,7 +51,7 @@ userRouterApi.post('/', ...
     const data = await userService.create(user);
     res.status(201).json({
       message: 'user created',
-      data,
+      data: data.toPublic(),
     });
@@ -73,7 +73,7 @@ userRouterApi.patch('/:id', ...
     const data = await userService.update(user);
     res.status(200).json({
       message: 'user updated',
-      data,
+      data: data.toPublic(),
     });
```

**After (handler GET / completo como referencia):**

```js
userRouterApi.get('/', async (req, res, next) => {
  const { offset, limit } = req.query;
  try {
    const data = await userService.find(null, { offset, limit });
    res.status(200).json({
      message: 'users retrieved',
      data: data.map((u) => u.toPublic()),
    });
  } catch (error) {
    next(error);
  }
});
```

### Impacto

- **Corrige:** fuga de tokens de autenticación en todas las respuestas de la API de usuarios.
- **Breaking change de contrato:** los campos `auth.*` desaparecen de las respuestas JSON. Si hay clientes que leen `data.auth.apiToken` de la respuesta, deberán actualizarse. Dado que la API actualmente está desprotegida y es un proyecto en construcción, este es el momento correcto para hacer el cambio.
- El campo `role` sí se expone en `toPublic()` dado que es necesario para la UI (control de acceso en cliente).

### Tests

Archivo: `src/api/users/models/__test__/user.test.js`

| Caso | Entrada | Expectativa sobre `toPublic()` |
|------|---------|-------------------------------|
| Usuario completo | todas las propiedades incluyendo tokens | `auth` ausente; `id`, `email`, `firstName`, `lastName`, `groups`, `role`, `created`, `updated` presentes |
| Usuario sin `created`/`updated` | campos opcionales ausentes | `created` y `updated` son `undefined` (no lanza) |

Archivo: `src/api/users/routes/__test__/user.route.api.test.js`

| Caso | Endpoint | Expectativa |
|------|----------|-------------|
| `GET /` | lista de usuarios | `data[0]` no contiene `auth` |
| `GET /:id` | usuario individual | `data` no contiene `auth` |
| `POST /` | creación | `data` no contiene `auth` |
| `PATCH /:id` | actualización | `data` no contiene `auth` |

---

## 0.7 — CORS configurado incorrectamente para `'*'`

### Diagnóstico

**Archivos:** `src/app.js` + `src/config/index.js`

```js
// config/index.js línea 5
cors: process.env.CORS || '*',

// app.js líneas 14-18
app.use(
  cors({
    origin: config.cors.split(','),
  })
);
```

**Problema:** cuando `CORS` no está definida en el entorno, `config.cors` es la cadena `'*'`. Al hacer `'*'.split(',')` el resultado es `['*']` (un array con un solo elemento). La librería `cors` de npm acepta como `origin`:

- `true` — refleja el origin del request
- `string` — un único origen exacto
- `RegExp` — patron
- `Array<string|RegExp>` — lista de orígenes exactos
- `Function` — callback personalizado
- `'*'` como **string** (no como array) — wildcard que permite cualquier origen

Cuando `origin` es `['*']` (array con la cadena `'*'`), la librería compara literalmente cada string del array contra el header `Origin` de la petición. Sólo permite exactamente la cadena `'*'` como valor de `Origin`, que **ningún navegador envía jamás**. El efecto es que en el entorno por defecto (sin variable de entorno configurada) **CORS está efectivamente deshabilitado** para todos los clientes navegador.

En entornos con `CORS=https://myapp.com,https://admin.myapp.com` el comportamiento es correcto porque ninguno de esos valores es `'*'` y el array de strings funciona como lista de orígenes permitidos.

### Cambio propuesto

La corrección debe manejar el wildcard como caso especial:

```diff
--- a/src/app.js
+++ b/src/app.js
@@ -14,7 +14,8 @@ app.use(
   cors({
-    origin: config.cors.split(','),
+    origin: config.cors === '*' ? '*' : config.cors.split(','),
   })
 );
```

**After:**

```js
app.use(
  cors({
    origin: config.cors === '*' ? '*' : config.cors.split(','),
  })
);
```

Alternativamente, la lógica puede centralizarse en `config/index.js`:

```diff
--- a/src/config/index.js
+++ b/src/config/index.js
@@ -4,5 +4,5 @@ require('dotenv').config();
 module.exports = {
   dev: process.env.NODE_ENV != 'production',
   port: process.env.PORT || 3000,
-  cors: process.env.CORS || '*',
+  cors: process.env.CORS ? process.env.CORS.split(',') : '*',
```

Y en `app.js` eliminar el `.split()`:

```diff
-    origin: config.cors.split(','),
+    origin: config.cors,
```

**Se recomienda la segunda opción** (centralizar en `config/index.js`) porque mantiene la lógica de parseo de configuración en un solo lugar y simplifica el uso en `app.js`.

### Impacto

- **Corrige:** CORS wildcard (`*`) funciona correctamente en entorno sin configuración.
- **No breaking change:** entornos con `CORS=url1,url2` funcionaban y siguen funcionando.
- **Seguridad:** en producción **debe** configurarse `CORS` explícitamente con los orígenes permitidos. El wildcard solo es aceptable en desarrollo.

### Tests

Archivo: `src/__test__/app.cors.test.js` (o integrado en el test de la app)

| Caso | `process.env.CORS` | `Origin` del request | Resultado esperado |
|------|--------------------|-----------------------|-------------------|
| Sin configurar | no definida | `http://localhost:3000` | header `Access-Control-Allow-Origin: *` presente |
| Sin configurar | no definida | cualquier origen | header presente |
| Lista de orígenes | `https://a.com,https://b.com` | `https://a.com` | header `Access-Control-Allow-Origin: https://a.com` |
| Lista de orígenes | `https://a.com,https://b.com` | `https://c.com` | sin header CORS (origen denegado) |

---

## Orden de implementación

El orden minimiza el riesgo de regresión entre tareas con dependencias:

```
0.1  validatorHandler return          — independiente, fix puntual
0.2  cleanDocObject objetos vacíos    — prerequisito de 0.3
0.3  updateUserParser PATCH auth      — depende de 0.2
0.4  getByEmail retorna User          — independiente de 0.2/0.3
0.5  delete() verifica existencia     — independiente
0.6  toPublic() en User y routes      — independiente, pero mejor hacerlo
                                        antes de habilitar auth para no
                                        filtrar tokens por error
0.7  CORS config                      — independiente, puede ir en cualquier
                                        momento
```

**Secuencia recomendada:** `0.1 → 0.7 → 0.5 → 0.4 → 0.2 → 0.3 → 0.6`

Razonamiento:
- `0.1` primero porque afecta a toda la pipeline de validación y los tests de las tareas siguientes dependen de que el middleware funcione.
- `0.7` y `0.5` son ortogonales; se colocan temprano para cerrar problemas de infraestructura.
- `0.2` antes de `0.3` por la dependencia directa.
- `0.6` al final de la fase porque introduce un breaking change de contrato HTTP que conviene aplicar una sola vez, después de que el resto de la capa de datos esté saneada.
