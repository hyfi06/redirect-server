# Spec técnico — v3: Cleanup técnico (baja prioridad)

**Fecha:** 2026-06-09  
**Rama:** `v3-beta`  
**Objetivo:** Resolver los ítems clasificados como Baja prioridad en el diagnóstico `2026-06-08_02_v3-production-readiness.md`. Son cambios sin impacto en comportamiento externo: eliminación de dead code, corrección de notación, y documentación de un runbook operativo.

**Estado:** Implementación completa — todos los ítems en `[x]`.

**Ítems cubiertos:**

| ID | Descripción | Estado |
|---|---|---|
| ROB-3 | Eliminar `await` innecesario sobre `CollectionReference` en `CrudService.getAll()` | [x] |
| DT-2 | Eliminar `src/models/scope.model.js` y `src/models/groups.js` (dead code) | [x] |
| DT-3 | Eliminar paquete `accesscontrol` (instalado pero sin uso) | [x] |
| DT-5 | Eliminar `updateUserSchema` legacy de `src/api/users/schemas/user.schema.js` | [x] |
| CFG-4 | Corregir `engines.node` en `package.json` de `"24.x.x"` a `">=24.0.0"` | [x] |
| DT-1 | Documentar runbook de verificación de consistencia `Group.users ↔ User.groups` | [x] |

---

## §1 — ROB-3: `await` innecesario en `CrudService.getAll()`

### Contexto

`src/utils/crud.service.js`, línea 38:

```js
const fsCollection = await this.db.collection;
```

`this.db.collection` es una `CollectionReference` de Firestore — una propiedad sincrónica del `FireStoreAdapter`, no una `Promise`. `await` sobre un valor no-thenable lo resuelve de inmediato con el mismo valor, por lo que no hay error en runtime. Sin embargo el `await` sugiere una incomprensión del API y confunde a cualquier lector que busque la operación asíncrona.

El método `find()` en la misma clase (línea 71) hace la asignación equivalente sin `await`:
```js
let fsQuery = this.db.collection;
```

### Cambio exacto

**Archivo:** `src/utils/crud.service.js`, línea 38

```js
// Antes:
const fsCollection = await this.db.collection;

// Después:
const fsCollection = this.db.collection;
```

### Tests

Los tests existentes en `src/utils/__test__/crud.service.test.js` ya cubren `getAll()`. No se requieren tests nuevos — ejecutar el suite completo para confirmar que no hay regresiones.

### Archivos afectados

| Archivo | Tipo de cambio |
|---|---|
| `src/utils/crud.service.js` | Modificado |

---

## §2 — DT-2: Eliminar dead code — modelos legacy

### Contexto

Dos archivos no tienen ningún consumer activo en `src/`:

| Archivo | Motivo de obsolescencia |
|---|---|
| `src/models/scope.model.js` | `Scope`, `OWNER_SCOPES`, `PERMISSIONS` no son importados en ningún archivo de producción. La lógica de permisos pasó a ser un array de strings `"read:{group}"` gestionado directamente en los schemas y handlers. |
| `src/models/groups.js` | Modelo `Group` legacy, reemplazado por `src/api/groups/models/group.model.api.js` en la arquitectura de v3. |

Verificación (ningún resultado fuera del propio archivo):
```bash
grep -r "scope.model\|models/groups\|OWNER_SCOPES\|Scope" src/ --include="*.js" -l
# → src/models/scope.model.js (solo se referencia a sí mismo)
```

### Cambio exacto

Eliminar ambos archivos:
- `src/models/scope.model.js`
- `src/models/groups.js`

### Tests

No se requieren tests nuevos. Ejecutar el suite completo para confirmar que ningún módulo los importa.

### Archivos afectados

| Archivo | Tipo de cambio |
|---|---|
| `src/models/scope.model.js` | Eliminado |
| `src/models/groups.js` | Eliminado |

---

## §3 — DT-5: Eliminar `updateUserSchema` legacy

### Contexto

`src/api/users/schemas/user.schema.js` exporta `updateUserSchema` con el comentario:

```js
// Retained for export compatibility — no active consumers after the schema split (R4)
```

No existe ningún import de `updateUserSchema` fuera del propio archivo (verificado con grep). El schema fue dividido en `updateUserByAdminSchema` + `updateUserSelfSchema` con `selectUpdateSchema()` como selector. La exportación legacy es dead code.

### Cambio exacto

**Archivo:** `src/api/users/schemas/user.schema.js`

Eliminar líneas 30–36 (la declaración) y `updateUserSchema,` del `module.exports`:

```js
// Eliminar:
// Retained for export compatibility — no active consumers after the schema split (R4)
const updateUserSchema = Joi.object({
  firstName: name,
  lastName: name,
  groups: groups,
  auth: auth,
});
```

```js
// module.exports — antes:
module.exports = {
  idSchema,
  createUserSchema,
  updateUserSchema,       // ← eliminar esta línea
  updateUserByAdminSchema,
  updateUserSelfSchema,
  selectUpdateSchema,
};
```

### Tests

Los tests existentes de `user.schema` no importan `updateUserSchema`. Ejecutar el suite completo para confirmar.

### Archivos afectados

| Archivo | Tipo de cambio |
|---|---|
| `src/api/users/schemas/user.schema.js` | Modificado |

---

## §4 — DT-3 + CFG-4: Limpiar `package.json`

### Contexto

Dos problemas independientes en `package.json` se agrupan en una unidad porque ambos son cambios de configuración en el mismo archivo sin impacto en el código de producción.

#### DT-3 — `accesscontrol` sin uso

`"accesscontrol": "^2.2.1"` está en `dependencies` de producción. Ningún archivo en `src/` lo importa (verificado con grep). Añade peso al bundle de App Engine sin aportar funcionalidad.

**Cambio:** Ejecutar `npm uninstall accesscontrol`, que lo elimina de `package.json` y `package-lock.json`.

#### CFG-4 — Notación semver incorrecta en `engines.node`

```json
"engines": { "node": "24.x.x" }
```

`24.x.x` no es semver estándar. npm puede emitir advertencias en `npm install`. La notación correcta para "Node.js 24 o superior" es `">=24.0.0"`. App Engine no usa este campo (usa el `runtime` de `app.yaml`), pero es convención correcta.

**Cambio:**
```json
"engines": { "node": ">=24.0.0" }
```

### Archivos afectados

| Archivo | Tipo de cambio |
|---|---|
| `package.json` | Modificado (`engines.node` + eliminación de `accesscontrol`) |
| `package-lock.json` | Actualizado por `npm uninstall` |

---

## §5 — DT-1: Runbook de consistencia `Group.users ↔ User.groups`

### Contexto

`GroupService.update()` sincroniza `User.groups` para los miembros añadidos/removidos mediante un loop de writes individuales (estrategia fetch-first descrita en D15). Si un write falla a mitad del loop, algunos usuarios quedan con `groups` actualizado y otros no — el documento del grupo se escribe al final con `super.update()`, por lo que el grupo refleja el estado nuevo mientras algunos usuarios reflejan el estado anterior.

Este estado es inconsistente pero recuperable manualmente. No se puede corregir de forma automática sin refactorizar a Firestore batch writes (camino a v4).

**DT-1** pide documentar el procedimiento de detección y corrección manual para el runbook operativo.

### Cambio exacto

Crear `docs/runbooks/group-sync-consistency-check.md` con el procedimiento completo:

**Cuándo ejecutarlo:** Cuando `PATCH /api/v1/groups/:id` responde 500 con un error en la sincronización de membresía (visible en Cloud Logging con severidad `ERROR` y mensaje `Failed to add/remove group`).

**Procedimiento:**

1. Identificar el grupo afectado (ID en Firestore, campo `slug`).
2. Leer el documento del grupo en Firestore Console → campo `users` (estado nuevo).
3. Para cada email en el diff (añadidos + removidos), leer el documento del usuario → campo `groups`.
4. Detectar inconsistencias:
   - Usuario debería tener el slug pero no lo tiene → añadir manualmente a `User.groups`.
   - Usuario no debería tener el slug pero lo tiene → eliminar manualmente de `User.groups`.
5. Actualizar vía `PATCH /api/v1/users/:id` (admin) con los `groups` corregidos, O directamente en Firestore Console si la API no está disponible.
6. Verificar con `GET /api/v1/users/:id` que el campo `groups` es correcto.

### Archivos afectados

| Archivo | Tipo de cambio |
|---|---|
| `docs/runbooks/group-sync-consistency-check.md` | Nuevo |

---

## Orden de implementación

```
1. [refactor]  ROB-3       src/utils/crud.service.js
   [test]                  suite existente (sin tests nuevos)
   [docs]                  checkbox spec

2. [refactor]  DT-2 + DT-5   src/models/scope.model.js (delete)
                              src/models/groups.js (delete)
                              src/api/users/schemas/user.schema.js
   [test]                    suite existente (sin tests nuevos)
   [docs]                    checkbox spec

3. [chore]     DT-3 + CFG-4  package.json + package-lock.json
   [test]                    suite existente (sin tests nuevos)
   [docs]                    checkbox spec

4. [docs]      DT-1          docs/runbooks/group-sync-consistency-check.md
```

Las unidades 1, 2, 3, 4 son independientes entre sí.

---

## Verificación final

```bash
npm test   # 498+ tests, sin regresiones
grep -r "scope.model\|models/groups\|updateUserSchema\|accesscontrol" src/ --include="*.js"
# → sin resultados
```
