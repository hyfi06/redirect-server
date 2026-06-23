# Plan — Hotfix: `PATCH /users/:id` sobreescribe `groups` con `[]`

**Fecha:** 2026-06-23
**Estado:** ABIERTO
**Rama:** `hotfix-patch-user-groups-overwrite`
**Diagnóstico de referencia:** `docs/diag/2026-06-23_03_patch-user-overwrites-groups.md`

---

## Contexto

El constructor de `User` asigna `this.groups = groups || []`. Cuando `PATCH /api/v1/users/:id` recibe un body sin el campo `groups`, el constructor materializa `undefined` como `[]`. El `updateUserParser` no puede eliminar ese valor porque `cleanDocObject` no toca arrays vacíos. Firestore recibe `groups: []` y sobreescribe el array real del usuario.

El patrón correcto ya existe en el mismo constructor para `role` (decisión D20): el constructor no pone default; el default vive en `createUserParser`. `groups` debe seguir exactamente ese mismo patrón.

El impacto en producción fue la pérdida de las membresías de grupo del usuario `DDrSZJel8fee3C9uW8aA`, restauradas manualmente el 2026-06-23.

---

## §1 — Fix en el constructor `User` y en `createUserParser`

**Archivos:**

- `src/api/users/models/user.model.js` — línea 36
- `src/api/users/parsers/user.parser.js` — línea 34

El backend-engineer debe aplicar el patrón D20 al campo `groups`:

En el constructor, la asignación de `groups` debe quedar sin default — `this.groups = groups` — de modo que cuando el campo no llegue en el payload del PATCH, la propiedad sea `undefined` y `cleanDocObject` la excluya del objeto de escritura a Firestore.

En `createUserParser`, la línea que escribe el campo `groups` al payload de creación debe aplicar el default `|| []`. Esto garantiza que los nuevos usuarios siempre tengan `groups: []` en Firestore cuando el campo no se especifica en el body de creación, sin depender del constructor para aplicar ese default.

El backend-engineer no debe modificar `updateUserParser` ni `cleanDocObject`. El comportamiento de `cleanDocObject` con arrays vacíos es correcto y deliberado; el fix opera aguas arriba, en el origen del valor.

El backend-engineer no debe introducir un comentario que documente el cambio en el constructor. Ese comentario se añade en el paso de docs (§3).

**Commit esperado:**

```
[fix] apply D20 pattern to User.groups — no default in constructor

plan: 2026-06-23_02_hotfix-patch-user-groups §1
- this.groups = groups (no default) in src/api/users/models/user.model.js
- groups: user.groups || [] in createUserParser in src/api/users/parsers/user.parser.js

Used agents: backend-engineer
```

---

## §2 — Tests de regresión

**Archivos:**

- `src/api/users/routes/__test__/user.route.patch.regression.test.js` — archivo nuevo (si ya existe un archivo de regresión para este handler, el test-engineer puede añadir los casos allí)
- `src/api/users/parsers/__test__/user.parser.test.js` — archivo existente o nuevo

El test-engineer debe cubrir los siguientes casos:

**Tests del handler (archivo de regresión del handler PATCH):**

El test principal es una prueba de regresión del bug: una solicitud `PATCH /api/v1/users/:id` con un body que contiene únicamente un campo distinto a `groups` (por ejemplo `{ "lastName": "..." }`) debe resultar en que el payload enviado a `UserService.update()` — o directamente a Firestore, si el test llega hasta allí — no contenga el campo `groups`. La clave `groups` debe estar ausente del objeto de escritura, no presente con valor `[]`.

El test-engineer debe decidir el nivel de aislamiento apropiado: un test que intercepta la llamada a `userService.update` y verifica el argumento recibido es suficiente para detectar la regresión. Un test de integración completo que alcance Firestore también es válido si el proyecto ya tiene ese patrón establecido.

**Tests del parser (`user.parser.test.js`):**

Dos casos unitarios:

1. `createUserParser` llamado con un `User` construido sin `groups` en el payload debe devolver un objeto con `groups: []`.
2. `updateUserParser` llamado con un `User` construido sin `groups` en el payload debe devolver un objeto sin la clave `groups` (la clave debe estar ausente, no ser `[]` ni `undefined`).

Estos dos casos verifican que la barrera se mantiene en el lugar correcto (capa de parseo) y que `cleanDocObject` cumple su contrato para este campo.

**Commit esperado:**

```
[test] regression: PATCH without groups must not overwrite groups field

plan: 2026-06-23_02_hotfix-patch-user-groups §2
- handler regression test in src/api/users/routes/__test__/user.route.patch.regression.test.js
- parser unit tests in src/api/users/parsers/__test__/user.parser.test.js

Used agents: test-engineer
```

---

## §3 — Docs: JSDoc del constructor, cierre del plan y diagnóstico, bump de versión

**Archivos:**

- `src/api/users/models/user.model.js` — JSDoc del constructor (bloque `@param` y comentario en línea junto a `this.groups`)
- `docs/diag/2026-06-23_03_patch-user-overwrites-groups.md` — marcar `Estado: RESUELTO`, añadir referencia al commit de §1 en la sección §8
- `docs/plan/2026-06-23_02_hotfix-patch-user-groups.md` (este archivo) — marcar todos los pasos como completados (`§1 ✅`, `§2 ✅`, `§3 ✅`) y cambiar `Estado: CERRADO`
- `package.json` — bump de versión de parche: `4.0.2` → `4.0.3`

El docs-engineer debe añadir al constructor de `User`, junto a la línea `this.groups = groups`, un comentario que documente la razón del cambio en paralelo al comentario existente de `role`: que `groups: undefined` en un body de PATCH debe permanecer `undefined` para que `cleanDocObject` lo omita, y que el default `[]` se aplica en `createUserParser`. La formulación exacta queda a criterio del docs-engineer, pero debe referenciar el mismo patrón D20 que el comentario de `role`.

El docs-engineer no debe actualizar `CLAUDE.md` ni `docs/api/v1.md` salvo que la descripción del `User` constructor o del `updateParser` en esos documentos contenga texto que resulte incorrecto tras el fix — en ese caso debe corregirlo con el alcance mínimo necesario.

**Commit esperado:**

```
[docs] close hotfix plan, update User constructor JSDoc, bump to 4.0.3

plan: 2026-06-23_02_hotfix-patch-user-groups §3
- JSDoc y comentario D20 en src/api/users/models/user.model.js
- Estado RESUELTO en docs/diag/2026-06-23_03_patch-user-overwrites-groups.md
- Plan cerrado en docs/plan/2026-06-23_02_hotfix-patch-user-groups.md
- Version bump en package.json

Used agents: docs-engineer
```

---

## Orden de ejecución

```
§1 [fix]  →  §2 [test]  →  §3 [docs]
```

Cada paso produce un commit independiente. No mezclar producción, tests y docs en el mismo commit.
