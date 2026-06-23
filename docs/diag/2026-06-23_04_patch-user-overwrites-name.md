# Bug Report — `PATCH /api/v1/users/:id` sobreescribe `firstName` o `lastName` cuando el body no incluye ambos campos

**Fecha:** 2026-06-23
**Estado:** RESUELTO
**Severidad:** Crítica — corrupción silenciosa de datos; sin error visible para el cliente
**Relacionado con:** `docs/diag/2026-06-23_03_patch-user-overwrites-groups.md` (mismo archivo, mismo patrón de constructor — D20)

---

## 1. Descripción del fallo

Toda solicitud a `PATCH /api/v1/users/:id` que actualice solo uno de los campos `firstName` o `lastName` borra silenciosamente el otro campo en Firestore, reemplazándolo por `''`.

**Comportamiento observado:**

```
PATCH /api/v1/users/{USER_ID}
Body: { "firstName": "Ana" }

Antes: { firstName: "Ana", lastName: "García" }
Después: { firstName: "Ana", lastName: "" }
```

```
PATCH /api/v1/users/{USER_ID}
Body: { "lastName": "López" }

Antes: { firstName: "Becas", lastName: "Facultad" }
Después: { firstName: "", lastName: "López" }
```

**Comportamiento esperado:** cuando uno de los campos de nombre no está en el body del PATCH, el campo debe permanecer intacto en Firestore. Solo los campos presentes en el payload deben actualizarse.

---

## 2. Causa raíz

El bug es el resultado de la interacción entre tres puntos del código, idéntica en estructura al bug de `groups` documentado en `docs/diag/2026-06-23_03_patch-user-overwrites-groups.md`.

### 2.1 Constructor `User` — `src/api/users/models/user.model.js`, líneas 35 y 37 (antes del fix)

```js
this.firstName = firstName?.trim() || '';
this.lastName  = lastName?.trim()  || '';
```

Cuando el handler de `PATCH /:id` construye el modelo sin incluir `firstName` o `lastName` en el payload, el parámetro desestructura como `undefined`. La expresión `undefined?.trim()` evalúa a `undefined`; el operador `|| ''` convierte ese `undefined` en la cadena vacía `''`. El campo deja de ser `undefined` y pasa a ser un valor concreto.

### 2.2 `updateUserParser` — `src/api/users/parsers/user.parser.js`, líneas 46–58

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

`cleanDocObject` (en `src/utils/clean.data.utils.js`) elimina claves cuyo valor es `undefined` o un objeto vacío, pero no elimina strings vacías: `''` no es `undefined`, por lo que `cleanDocObject` conserva `firstName: ''` y `lastName: ''` en el payload de escritura.

### 2.3 Resultado: Firestore recibe `firstName: ''` o `lastName: ''`

El payload que llega a `FireStoreAdapter.update()` puede contener `{ firstName: 'Ana', lastName: '' }` cuando el body del PATCH solo tenía `firstName`. Firestore interpreta esto como una asignación explícita `lastName = ''`, sobreescribiendo el valor previo.

---

## 3. Por qué `role` y `groups` no tenían este problema (tras sus respectivos fixes)

Ambos campos ya seguían el patrón correcto documentado como D20:

| Campo | Constructor (post-fix) | Default aplicado en |
|---|---|---|
| `role` | `this.role = role` | `createUserParser`: `role: user.role \|\| 'user'` |
| `groups` | `this.groups = groups` | `createUserParser`: `groups: user.groups \|\| []` |

Cuando `role` o `groups` no están en el body del PATCH, el constructor asigna `undefined`. `cleanDocObject` los elimina. Firestore no recibe el campo.

`firstName` y `lastName` debían seguir exactamente el mismo patrón. En cambio, usaban `|| ''`, probablemente copiado de una convención anterior a D20 o introducido por la intención de que el nombre siempre sea una cadena en el modelo.

---

## 4. Impacto

### Impacto en datos

- `firstName` o `lastName` de un usuario pueden haber sido silenciosamente vaciados al procesar cualquier `PATCH` que no incluyera ambos campos de nombre.
- No hay mecanismo de detección automática: el cliente recibe HTTP 200 y el campo vaciado aparece como cadena vacía en la respuesta.

### Impacto funcional

Los campos `firstName` y `lastName` alimentan los getters `fullNameByName` y `fullNameByLastName`. Un vaciado silencioso corrompe toda presentación de nombre derivada de esos getters hasta que el dato sea restaurado manualmente.

---

## 5. Archivos afectados

| Archivo | Rol | Línea exacta (antes del fix) |
|---|---|---|
| `src/api/users/models/user.model.js` | Constructor `User` — defaults `\|\| ''` que causan la corrupción | 35, 37 |
| `src/api/users/parsers/user.parser.js` | `createUserParser` — debe aplicar los defaults `\|\| ''` en creación | 33–34 |
| `src/api/users/parsers/user.parser.js` | `updateUserParser` — no puede eliminar `firstName: ''` porque `cleanDocObject` no toca strings vacías | 46–58 |
| `src/utils/clean.data.utils.js` | `cleanDocObject` — no elimina strings vacías (comportamiento correcto, no debe cambiarse) | 6–23 |

---

## 6. Análisis de cobertura de tests

No existía ningún test que verificara que `PATCH /api/v1/users/:id` con un body parcial (sin `lastName`) preservara el campo `lastName` en Firestore, ni viceversa. El gap es análogo al documentado en `docs/diag/2026-06-23_03_patch-user-overwrites-groups.md §6`.

---

## 7. Corrección

La corrección consiste en dos cambios simétricos que implementan el patrón D20 para `firstName` y `lastName`:

**En el constructor (`src/api/users/models/user.model.js`, líneas 35 y 37):** reemplazar `|| ''` por `|| undefined`. Cuando el PATCH no incluye el campo, el constructor asigna `undefined`, y `cleanDocObject` lo omite del payload de escritura.

**En `createUserParser` (`src/api/users/parsers/user.parser.js`, líneas 33–34):** aplicar los defaults en la capa de parseo de creación, no en el constructor:

```js
firstName: user.firstName || '',
lastName:  user.lastName  || '',
```

Esta combinación garantiza que un usuario nuevo siempre tenga cadenas en Firestore, mientras que un PATCH parcial no toca los campos ausentes.

| Campo | Constructor (post-fix) | `createUserParser` | `updateUserParser` |
|---|---|---|---|
| `firstName` | `this.firstName = firstName?.trim() \|\| undefined` | `firstName: user.firstName \|\| ''` | `cleanDocObject` elimina `undefined` |
| `lastName` | `this.lastName = lastName?.trim() \|\| undefined` | `lastName: user.lastName \|\| ''` | `cleanDocObject` elimina `undefined` |

---

## 8. Resolución

**Estado:** RESUELTO

Fix aplicado en commit `edc16c9` ([fix] remove non-undefined defaults from model constructors (D20)).
Tests de regresión añadidos en commit `5b27fb6` ([test] firstName and lastName isolated on PATCH without both fields).
