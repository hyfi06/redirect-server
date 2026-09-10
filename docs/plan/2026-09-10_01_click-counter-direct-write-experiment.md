# Plan — Experimento: escritura directa a Firestore por click

**Spec:** `docs/spec/2026-09-10_01_click-counter-direct-write-experiment.md`
**Fecha:** 2026-09-10
**Rama:** `dev`
**Estado:** EN PRUEBA

---

## Contexto

Ver el spec de referencia para el problema de costo, la causa raíz, y la decisión acordada. Resumen operativo: `src/utils/click-counter.js` deja de acumular clicks en memoria y pasa a escribir cada click directamente a Firestore; `src/app.js` pierde el `SIGTERM` handler que solo existía para drenar ese estado en memoria; `app.yaml` vuelve a `min_instances: 0`. La firma pública de `click-counter.js` (`increment(redirectId)`) no cambia, así que `src/redirect/routes/redirect.router.js` no requiere ningún cambio.

Este plan no incluye el bump de versión ni el merge a `main` — eso depende del resultado del experimento (ver spec, "Criterio de éxito / fracaso" y "Plan de reversión") y es un trabajo posterior fuera de este alcance.

---

## §0 ✅ — Confirmar `min_instances: 0` en `app.yaml`

El working tree de `dev` ya tenía este cambio sin commitear al iniciar este plan. Se commitea de forma aislada, como cambio de infraestructura puro, independiente del refactor de código en §1 — para que el historial de `dev` deje trazado por separado "qué se cambió en cómputo" de "qué se cambió en el conteo de clicks", igual que `591b7cf` lo hizo en `v4.2.0`.

- [x] Paso: commitear `app.yaml` con `min_instances: 1` → `min_instances: 0`, tipo `[chore]`, referenciando este plan.

**Commit esperado:**

```
[chore] set min_instances: 0 — click counter no longer needs an always-on instance

plan: 2026-09-10_01_click-counter-direct-write-experiment §0
- min_instances changed from 1 to 0 in app.yaml
```

---

## §1 ✅ — Feat: escritura directa por click en `src/utils/click-counter.js` + retiro del `SIGTERM` handler

**Archivos:** `src/utils/click-counter.js`, `src/app.js`

El backend-engineer debe:

- Reescribir `src/utils/click-counter.js` para que `increment(redirectId)` ejecute directamente `FieldValue.increment(1)` sobre el documento del redirect en la colección de redirects, fire-and-forget (el caller — el catch-all — no espera esta promesa), con el mismo manejo de errores que hoy: logueados, nunca propagados. La firma exportada `increment(redirectId)` debe mantenerse idéntica a la actual para que `src/redirect/routes/redirect.router.js` no requiera ningún cambio (restricción del spec, sección "Decisión").
- Eliminar del módulo todo el estado y las funciones que dependían del batching en memoria: el `Map` de contadores, `FLUSH_THRESHOLD`, `flushAll()`, y `getCounters()`. Si algún consumidor fuera de los tests depende de `flushAll` o `getCounters`, el backend-engineer debe confirmarlo con un grep antes de eliminarlas (el spec ya identificó `src/app.js` como el único consumidor de `flushAll`, pero conviene verificar antes de borrar).
- Eliminar en `src/app.js` el `process.on('SIGTERM', ...)` que invoca `clickCounter.flushAll()`, y el `require('./utils/click-counter')` que ese handler necesitaba, si ningún otro punto de `src/app.js` importa el módulo. El spec es explícito en que este handler se retira por completo, no se deja como no-op (ver spec, sección "Decisión").
- No modificar `src/redirect/routes/redirect.router.js`. Si durante la implementación resulta que el call site sí necesita cambiar para que esto funcione, es una desviación de la decisión ya acordada en el spec — el backend-engineer debe parar y consultar antes de continuar, no improvisar una firma distinta.
- Decidir, siguiendo el estilo ya usado en el módulo, si conserva el nombre del archivo `click-counter.js` (ya no "cuenta" nada en memoria, escribe directo) o lo considera consistente igual — no es necesario renombrarlo para este experimento; renombrar archivos que otros módulos importan es un cambio de mayor alcance que no aporta valor a la comparación de costo que se está midiendo.

**Commit esperado:**

```
[feat] write click counts directly to Firestore per redirect hit

spec: 2026-09-10_01_click-counter-direct-write-experiment
plan: 2026-09-10_01_click-counter-direct-write-experiment §1
- src/utils/click-counter.js: increment(redirectId) writes FieldValue.increment(1)
  directly per call; in-memory Map, FLUSH_THRESHOLD, flushAll and getCounters removed
- src/app.js: SIGTERM handler and click-counter import removed (no in-memory
  state left to flush)

Used agents: backend-engineer
```

---

## §2 ✅ — Test: cobertura del nuevo comportamiento de `click-counter.js`

**Archivos:** `src/utils/__test__/click-counter.test.js`

El test-engineer debe:

- Reescribir el suite existente para el nuevo comportamiento de `increment(redirectId)`: cada llamada dispara exactamente una escritura Firestore (`FieldValue.increment(1)`) contra el documento correcto (`collection(...).doc(redirectId).update(...)`), sin ningún umbral ni acumulación — N llamadas a `increment` con el mismo `redirectId` deben producir N escrituras independientes, no una sola escritura agregada.
- Cubrir el caso de fallo de Firestore: si la escritura rechaza (falla de red, timeout), el error se loguea y no se propaga al caller — mismo criterio que ya validaba el suite anterior para `_writeCounters`.
- Retirar los casos de prueba que ya no aplican: acumulación por debajo del umbral, flush al llegar al umbral con reseteo del contador local, `flushAll` sobre mapa con datos y sobre mapa vacío, y cualquier aserción sobre `getCounters()`.
- Verificar (grep o lectura directa) que no queda ningún test en el repositorio que siga referenciando `flushAll`, `getCounters`, o el `SIGTERM` handler retirado de `src/app.js` — ni en `click-counter.test.js` ni en ningún otro archivo de test que pudiera mockear estos símbolos.
- No es necesario ningún cambio en `src/redirect/routes/__test__/redirect.route.test.js`: el call site de `clickCounter.increment(id)` no cambió (§1), así que su cobertura existente sigue siendo válida sin modificación.

**Commit esperado:**

```
[test] cover per-click direct Firestore writes in click-counter

spec: 2026-09-10_01_click-counter-direct-write-experiment
plan: 2026-09-10_01_click-counter-direct-write-experiment §2
- src/utils/__test__/click-counter.test.js rewritten for one-write-per-call
  behavior; threshold/flushAll/getCounters cases removed

Used agents: test-engineer
```

---

## §3 — Docs: reflejar el nuevo diseño en CLAUDE.md

**Archivos:** `CLAUDE.md`, `docs/spec/2026-09-10_01_click-counter-direct-write-experiment.md`, este plan

El docs-engineer debe:

- Actualizar la sección "Caching" de `CLAUDE.md` (bullet "Click counter") para describir el comportamiento nuevo: cada click escribe directo a Firestore vía `FieldValue.increment(1)`, sin acumulación en memoria ni umbral de flush. Retirar cualquier mención a `flushAll()`, al umbral N=10, y a la necesidad de `min_instances: 1` para preservar estado — ese estado ya no existe.
- Si `CLAUDE.md` menciona en algún otro punto (por ejemplo, en la descripción del bootstrap de `src/app.js` o en la sección de deployment) el `SIGTERM` handler del click counter, retirar esa mención también.
- Revisar si `src/utils/click-counter.js` necesita comentarios JSDoc actualizados tras el refactor de §1 (la función `increment` cambia de responsabilidad; el comentario que hoy explica `FLUSH_THRESHOLD = 10` deja de aplicar).
- Marcar en este plan los pasos §0, §1 y §2 como completados (`[x]`) y `Estado: EN PRUEBA` (no `CERRADO` — el plan de implementación termina aquí, pero el experimento en sí sigue abierto hasta que se evalúe el costo real; ver spec, "Criterio de éxito / fracaso"). No marcar el spec como completado por la misma razón — su `Estado` permanece `EN EXPERIMENTACIÓN` hasta que haya un resultado de costo que registrar.
- **No** tocar `package.json` ni añadir una entrada de `CHANGELOG.md` en este paso — el bump de versión está deliberadamente fuera de alcance de este plan (ver spec, "Impacto en versión"); se ejecuta en el commit que cierre el experimento, condicionado a su resultado.

**Commit esperado:**

```
[docs] reflect direct-write click counter in CLAUDE.md

spec: 2026-09-10_01_click-counter-direct-write-experiment
plan: 2026-09-10_01_click-counter-direct-write-experiment §3
- CLAUDE.md Caching section updated: per-click direct Firestore write,
  no in-memory batching, no min_instances:1 dependency
- Plan marked EN PRUEBA (§0-§2 complete); spec stays EN EXPERIMENTACIÓN
  pending real cost data

Used agents: docs-engineer
```

---

## Orden de ejecución

```
§0 [chore] → §1 [feat] → §2 [test] → §3 [docs]
```

§0 es independiente y ya puede ejecutarse primero (es solo config). §1, §2, §3 siguen la secuencia estándar feat → test → docs sobre el mismo cambio de código.

## Notas de cierre del experimento (fuera de este plan)

Cuando haya datos reales de costo (ver spec, "Criterio de éxito / fracaso"), el cierre del experimento es un trabajo aparte, no cubierto por este plan:

- **Si es éxito:** merge de `dev` a `main`, bump de versión (`4.2.1` → `4.2.2` salvo que otro PATCH se haya intercalado antes), tag `v4.2.2` en `main`, siguiendo la convención de tagging del CLAUDE.md.
- **Si es fracaso:** no hay merge; `main` permanece como está. Documentar el resultado en el spec (`Estado: EXPERIMENTO FALLIDO`) y decidir si `dev` se resetea a `main` o se conserva como registro histórico (ver spec, "Plan de reversión").
