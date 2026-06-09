# Plan: v3 Cleanup técnico

**Spec:** `docs/spec/2026-06-09_02_v3-technical-cleanup.md`  
**Fecha:** 2026-06-09  
**Estado:** Pendiente

---

## Unidades de trabajo

### Unidad 1 — ROB-3: Eliminar `await` sobre `CollectionReference`

**Agente:** `backend-engineer`

**Cambio:**
```
src/utils/crud.service.js  línea 38
  - const fsCollection = await this.db.collection;
  + const fsCollection = this.db.collection;
```

**Ciclo:**
- [ ] `[refactor]` — eliminar `await` en línea 38 de `src/utils/crud.service.js`
- [ ] `[docs]` — marcar ROB-3 como `[x]` en el spec

**Tests:** suite existente cubre `getAll()` — no se requieren tests nuevos; ejecutar para confirmar sin regresiones.

---

### Unidad 2 — DT-2 + DT-5: Eliminar dead code

**Agente:** `backend-engineer`

**Cambios:**
- Eliminar `src/models/scope.model.js`
- Eliminar `src/models/groups.js`
- En `src/api/users/schemas/user.schema.js`:
  - Eliminar declaración de `updateUserSchema` (líneas 30–36)
  - Eliminar `updateUserSchema,` del `module.exports`

**Ciclo:**
- [ ] `[refactor]` — eliminar los 2 archivos y el export legacy
- [ ] `[docs]` — marcar DT-2 y DT-5 como `[x]` en el spec

**Tests:** suite existente — no se requieren tests nuevos.

---

### Unidad 3 — DT-3 + CFG-4: Limpiar `package.json`

**Agente:** `backend-engineer`

**Cambios:**
- `npm uninstall accesscontrol` → actualiza `package.json` y `package-lock.json`
- Cambiar `"engines": { "node": "24.x.x" }` → `"engines": { "node": ">=24.0.0" }`

**Ciclo:**
- [ ] `[chore]` — uninstall + fix engines
- [ ] `[docs]` — marcar DT-3 y CFG-4 como `[x]` en el spec

**Tests:** suite existente — no se requieren tests nuevos.

---

### Unidad 4 — DT-1: Runbook de consistencia Group ↔ User

**Agente:** `docs-engineer`

**Cambio:**
- Crear `docs/runbooks/group-sync-consistency-check.md` con el procedimiento de detección y corrección manual de inconsistencias `Group.users ↔ User.groups`.

Contenido basado en el §5 del spec:
1. Cuándo ejecutarlo: cuando `PATCH /api/v1/groups/:id` responde 500 con error de sync.
2. Identificar grupo afectado (ID + slug).
3. Leer `Group.users` (estado nuevo) en Firestore Console.
4. Para cada email del diff, leer `User.groups` y detectar inconsistencias.
5. Corregir vía `PATCH /api/v1/users/:id` (admin) o directamente en Firestore Console.
6. Verificar con `GET /api/v1/users/:id`.

**Ciclo:**
- [ ] `[docs]` — crear runbook + marcar DT-1 como `[x]` en el spec

---

## Verificación final

```bash
npm test
# → 498+ tests, sin regresiones

grep -r "scope.model\|models/groups\|updateUserSchema\|accesscontrol" src/ --include="*.js"
# → sin resultados
```

---

## Progreso

| Unidad | [refactor/chore] | [docs] |
|--------|-----------------|--------|
| ROB-3  | [ ] | [ ] |
| DT-2 + DT-5 | [ ] | [ ] |
| DT-3 + CFG-4 | [ ] | [ ] |
| DT-1 | — | [ ] |
