# Plan — Tech Debt Block 1: Bugs nuevos

**Diag:** docs/diag/2026-06-18_02_deuda-tecnica-v4-beta.md (BUG-1, BUG-2, BUG-3)
**Rama:** dev
**Fecha:** 2026-06-20

---

## Objetivo

Este plan cierra los tres bugs de severidad Media identificados en la auditoría de v4-beta. BUG-1 y BUG-2 son correcciones de una línea que no alteran comportamiento observable. BUG-3 es el ítem estructural del bloque: `DELETE /groups/:id` y `DELETE /users/:id` dejan referencias huérfanas en la colección opuesta. La solución requiere sobreescribir `delete()` en ambos servicios e introducir un `MembershipService` para romper la dependencia circular que emerge al hacerlo.

Al completarse el plan, el repositorio debe tener:

- `UserService.create()` con la guarda no-404 que ya tienen `RedirectService.create()` y `GroupService.create()`.
- `RedirectServiceApi.getByPath()` sin el `await` espurio sobre `CollectionReference.where()`.
- `GroupService.delete()` sobreescrito: WriteBatch atómico que limpia `User.groups` de cada miembro y borra el documento del grupo.
- `MembershipService` en `src/api/users/services/membership.service.js` que rompe la dependencia circular `UserService ↔ GroupService`.
- `UserService.delete()` sobreescrito: borra el usuario y delega la limpieza de `Group.users` a `MembershipService`.
- Tests que cubran las ramas nuevas de cada cambio (escritos por el test-engineer en el paso de test de cada unidad).

---

## Pasos

### Paso 1 — BUG-1 + BUG-2: guardia de unicidad y await espurio

Los dos cambios son de una línea cada uno. Se agrupan en un solo commit `[fix]` para evitar commits triviales; BUG-2 es puramente cosmético pero pertenece naturalmente al mismo pase de correcciones rápidas.

**Archivos afectados:**

| Archivo | Qué cambia |
|---------|-----------|
| `src/api/users/services/user.service.js` | El bloque `catch` de `create()` debe relanzar cualquier error cuyo `output?.statusCode` no sea 404, siguiendo el patrón establecido en `RedirectService.create()` (línea 45) y `GroupService.create()` (línea 40). Sin la guarda, un error transitorio de Firestore en `getByEmail()` puede resultar en un usuario duplicado creado silenciosamente. |
| `src/api/redirect/services/redirect.service.js` | Eliminar el `await` en la asignación de `query` en `getByPath()` (línea 27). `CollectionReference.where()` es síncrono y no retorna una Promise. El `await` no produce error pero es código incorrecto que puede inducir a confusión. |

**Criterio de aceptación:**

- `UserService.create()`: si `getByEmail()` lanza cualquier error que no sea 404, ese error se propaga al caller en lugar de ser absorbido. Solo el 404 permite continuar hacia la creación del documento.
- `RedirectServiceApi.getByPath()`: `query` es asignado síncronamente, sin `await`. El comportamiento en runtime es idéntico al anterior.
- `npm test` pasa sin regresiones.

**Tests esperados (test-engineer):** El test de `UserService.create()` debe cubrir el caso en que `getByEmail()` lanza un error no-404 (por ejemplo, un 500 de Firestore) y verificar que ese error es relanzado en lugar de silenciado. El caso de éxito y el caso de email duplicado ya deben estar cubiertos; el test-engineer verifica si existen y los completa si faltan.

Para BUG-2 no se requieren tests adicionales: el comportamiento de `getByPath()` no cambia.

**Commit type:** `[fix]`

---

### Paso 2 — BUG-3 parte 1: `GroupService.delete()` + extracción de `MembershipService`

Este paso implementa el lado Grupo del sync y extrae el `MembershipService` que el siguiente paso necesitará.

#### 2a — `GroupService.delete(id)`

**Archivo:** `src/api/groups/services/group.service.js`

Sobreescribir `delete(id)` en `GroupService`. La implementación debe:

1. Obtener el documento del grupo antes de borrarlo, para leer `group.users` (array de userId strings) y `group.slug`. Usar `this.findOne(id)`.
2. Construir un `WriteBatch` (vía `firestoreClient.batch()`, el mismo cliente que ya usa `update()`).
3. Por cada userId en `group.users`, añadir al batch una actualización del documento del usuario (`users/{userId}`) con `FieldValue.arrayRemove(group.slug)` aplicado al campo `groups`. No hacer fetch de cada usuario — confiar en que `group.users` es consistente porque todos los cambios de membresía pasan por `GroupService.update()`.
4. Añadir al batch el borrado del documento del grupo (`groupRef.delete()`).
5. Hacer commit del batch con `await batch.commit()`.
6. Retornar el `id` del grupo borrado (mismo contrato que `CrudService.delete()`).

El uso de `FieldValue.arrayRemove` garantiza que la operación es idempotente y no requiere leer los documentos de usuario: Firestore aplica el remove a nivel de servidor.

`Firestore` y `firestoreClient` ya están importados en `group.service.js` — no requiere nuevas importaciones de terceros.

**Criterio de aceptación:**

- `DELETE /api/v1/groups/:id` borra el documento del grupo y elimina el slug del grupo del campo `groups` de cada usuario miembro, en una operación atómica.
- Si el grupo no tiene usuarios (`group.users` vacío o ausente), el batch solo contiene el delete del grupo y se completa correctamente.
- `npm test` pasa sin regresiones.

#### 2b — `MembershipService`

**Archivo nuevo:** `src/api/users/services/membership.service.js`

CLAUDE.md ya anticipa este caso: *"If UserServices ever needs GroupService, extract sync to a MembershipService."*

`MembershipService` no extiende `CrudService`. Recibe `userService` y `groupService` por constructor injection, siguiendo el mismo patrón D12 que usa `GroupService` para recibir `userService`.

Expone un único método público: `removeUserFromAllGroups(userId, userGroups)`, donde:

- `userId` es el ID del documento de usuario que acaba de ser borrado.
- `userGroups` es el array de slugs de grupos al que pertenecía el usuario (leído del documento antes de borrarlo).

El método construye un `WriteBatch` y, por cada slug en `userGroups`, localiza el documento del grupo con `GroupService.getBySlug(slug)` para obtener su `id`, luego añade al batch una actualización con `FieldValue.arrayRemove(userId)` en el campo `users` del documento del grupo. No hace fetch completo del grupo solo para obtener `users` — el arrayRemove opera a nivel de servidor. Hace commit del batch y retorna.

Si `userGroups` está vacío o es undefined, el método retorna inmediatamente sin hacer ninguna operación en Firestore.

La dependencia circular `UserService → GroupService → UserService` queda rota porque `UserService` depende de `MembershipService` y `MembershipService` depende de `GroupService` — el ciclo se parte en dos ramas unidireccionales.

**Criterio de aceptación:**

- `removeUserFromAllGroups('userId123', ['fc', 'cs'])` produce un batch con dos actualizaciones (una por grupo) que eliminan `'userId123'` del campo `users` de cada grupo, en una sola operación atómica.
- Si `userGroups` es vacío o `undefined`, no se hace ninguna operación en Firestore.

**Tests esperados (test-engineer):** Tests unitarios para `GroupService.delete()` y `MembershipService.removeUserFromAllGroups()` en los directorios `__test__/` correspondientes:

- `GroupService.delete()`: grupo con miembros → batch contiene arrayRemove por cada miembro + delete del grupo. Grupo sin miembros → batch contiene solo el delete.
- `MembershipService.removeUserFromAllGroups()`: array no vacío → batch con arrayRemove por cada slug. Array vacío / undefined → no se llama a Firestore.

**Commit type:** `[feat]`

---

### Paso 3 — BUG-3 parte 2: `UserService.delete()` con `MembershipService`

**Archivos afectados:**

| Archivo | Qué cambia |
|---------|-----------|
| `src/api/users/services/user.service.js` | Nuevo método `delete(id)` que sobreescribe `CrudService.delete()`. |
| (constructor) | `UserService` recibe `membershipService` por constructor injection. |

#### Wiring de `MembershipService`

`UserService` necesita una instancia de `MembershipService` para delegar la limpieza. La inyección sigue el patrón D12: el constructor de `UserService` acepta `membershipService` como parámetro opcional. Los sites de instanciación actuales crean `new UserServices()` sin argumentos — el backend-engineer debe identificar todos los puntos donde se instancia `UserService` y actualizarlos para pasar una instancia de `MembershipService`.

Los sites de instanciación conocidos a la fecha de este plan son: `src/api/redirect/routes/redirect.route.api.js`, `src/api/groups/routes/group.route.api.js`, `src/middleware/authenticate.middleware.js`, y `src/utils/auth/strategies/google-oauth2.strategy.js`. El backend-engineer debe verificar si hay otros antes de modificar el constructor.

`MembershipService` recibe tanto `userService` como `groupService`. El backend-engineer debe evaluar en cada site de instanciación si ya existe una instancia de `GroupService` disponible para pasársela a `MembershipService`, o si debe crearse una nueva. El objetivo es mantener el patrón actual (cada módulo instancia sus dependencias directamente) sin añadir complejidad innecesaria.

La instancia de `MembershipService` en los sites que no llaman a `delete()` (como `authenticate.middleware.js`) puede pasarse como `undefined` o simplemente no instanciarse — el backend-engineer evalúa la forma más limpia. Si el constructor acepta el parámetro como opcional, los sites que no necesitan delete no sufren cambios de comportamiento.

#### `UserService.delete(id)`

Sobreescribir `delete(id)` en `UserService`. La implementación debe:

1. Obtener el documento del usuario antes de borrarlo, para leer `user.groups` (array de slugs). Usar `this.findOne(id)`.
2. Llamar a `super.delete(id)` para borrar el documento del usuario en Firestore.
3. Llamar a `this.membershipService.removeUserFromAllGroups(id, user.groups)` para limpiar el userId del campo `users` de cada grupo al que pertenecía.
4. Retornar el id del usuario borrado.

El paso 2 (borrado del usuario) y el paso 3 (limpieza de grupos) son operaciones Firestore separadas y no atómicas entre sí. Esto es aceptable en la arquitectura actual: el documento de usuario desaparece primero, y si la limpieza de grupos falla por un error transitorio, el estado quedaría con referencias huérfanas — el mismo estado que existe hoy. La mejora respecto al estado actual es que en el caso nominal (sin errores) ambas operaciones se completan, lo que cubre el 99%+ de los casos. Una solución completamente atómica requeriría agrupar el delete del usuario en el mismo WriteBatch de la limpieza de grupos; el backend-engineer evalúa si esa simplificación mejora la implementación y la propone si corresponde.

**Criterio de aceptación:**

- `DELETE /api/v1/users/:id` borra el documento del usuario y elimina el userId del campo `users` de cada grupo al que pertenecía.
- Si el usuario no pertenecía a ningún grupo (`user.groups` vacío o undefined), solo se borra el documento del usuario.
- `npm test` pasa sin regresiones.

**Tests esperados (test-engineer):** Tests unitarios para `UserService.delete()`:

- Usuario con grupos → se llama a `membershipService.removeUserFromAllGroups` con el id y los slugs correctos; el documento del usuario es borrado.
- Usuario sin grupos → se borra el documento sin llamar a `removeUserFromAllGroups` (o llamándolo con array vacío — lo que sea coherente con la implementación).
- `membershipService` ausente (constructor sin argumento) → el backend-engineer define si el método lanza o si delegar a super es seguro; los tests deben cubrir ese path.

**Commit type:** `[feat]`

---

## Orden de implementación

```
Paso 1: [fix] BUG-1 + BUG-2    →  [test]  →  [docs]
Paso 2: [feat] BUG-3 parte 1   →  [test]  →  [docs]
Paso 3: [feat] BUG-3 parte 2   →  [test]  →  [docs]
```

El Paso 2 debe completarse antes del Paso 3 porque `UserService.delete()` depende de que `MembershipService` exista como módulo.

---

## Notas para el backend-engineer

**`FieldValue.arrayRemove` — no requiere lectura del documento receptor:**

`FieldValue.arrayRemove(value)` es una operación server-side: Firestore elimina `value` del array en el documento destino sin que el cliente necesite leer ese array primero. Esto es lo que permite el enfoque no-fetch-first en `GroupService.delete()` y `MembershipService.removeUserFromAllGroups()`. La operación es idempotente: si el valor ya no está en el array, Firestore no falla.

**WriteBatch y `firestoreClient`:**

`GroupService` ya importa `firestoreClient` y `Firestore` de `@google-cloud/firestore`. `MembershipService` necesitará los mismos imports. El backend-engineer debe confirmar que `firestoreClient` es el singleton exportado por `src/lib/firestore-client.js` y usarlo directamente para construir el batch — el mismo patrón que `GroupService.update()`.

**Fetch-first en `UserService.delete()` antes del borrado:**

`this.findOne(id)` lanza `boom.notFound` si el documento no existe. Esto es el comportamiento correcto: un DELETE de un usuario inexistente debe retornar 404, no éxito. El fetch-first actúa como guard implícito.

**DI-1 (`UserServices` → `UserService`) no se toca en este plan:**

El renombrado de clase documentado como DI-1 en el diag pertenece al Bloque B de limpieza. Este plan trabaja sobre la clase tal como está nombrada actualmente. El backend-engineer no debe mezclar el renombrado con los fixes de este plan.
