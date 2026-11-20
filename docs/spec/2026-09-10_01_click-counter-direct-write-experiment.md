# Spec — Experimento: escritura directa a Firestore por click vs `min_instances: 1`

**Fecha:** 2026-09-10
**Rama:** `dev` (divergente de `main` desde `v4.2.1` / commit `acfc463`)
**Estado:** EXPERIMENTO EXITOSO — mergeado a `main` como `v4.2.2` (2026-11-20)
**Precedente:** `docs/spec/2026-06-28_01_v4.2.0.md` (diseño original del conteo de clicks — batching en memoria)

---

## Contexto y motivación

`v4.2.0` introdujo el conteo de clicks (`Redirect.clickCount`) acumulando hits en memoria (`Map<redirectId, number>` en `src/utils/click-counter.js`) y haciendo flush a Firestore con `FieldValue.increment(N)` cada N=10 clicks, o en `flushAll()` al recibir `SIGTERM`. Ese diseño asume que una instancia de App Engine vive el tiempo suficiente entre flushes para no perder conteos pendientes — razón por la cual el mismo spec fijó `min_instances: 1` en `app.yaml` (commit `591b7cf`): con al menos una instancia siempre activa, un reciclado de instancia dispara `SIGTERM` con tiempo de drenar el `Map` antes de morir, en vez de perder el estado sin aviso.

El gasto de Google Cloud del mes pasado (agosto 2026) subió, y `min_instances: 1` ya se bajó a `0` en el working tree de `app.yaml` (cambio sin commitear, en `dev`) para reducir costo. Esto reintroduce exactamente el riesgo que `min_instances: 1` existía para mitigar: con `min_instances: 0`, App Engine puede escalar a cero instancias entre requests, y una instancia puede reciclarse sin un `SIGTERM` limpio (o Firestore puede fallar durante el flush), perdiendo hasta 9 clicks por redirect en cada ocurrencia — un riesgo más frecuente cuanto más agresivo es el auto-scaling a cero.

## Causa raíz

El diseño de `v4.2.0` acopla dos decisiones que no tienen por qué ir juntas:

1. **Cómo se cuenta** (batching en memoria, flush cada N=10 clicks).
2. **Cómo se paga la infraestructura** (`min_instances: 1`, para que el batching no pierda datos).

La (1) obliga a la (2). Mientras el conteo dependa de estado en memoria que sobrevive entre requests, no hay forma de bajar `min_instances` a `0` sin aumentar el riesgo de pérdida de datos. El costo de mantener una instancia F1 siempre activa fue aceptado en `v4.2.0` bajo el supuesto de que cabía en el free tier (28 instance-hours/día gratis); ese supuesto ya no se sostiene frente al patrón de tráfico y gasto real observado.

## Decisión (Agreed solution)

**Eliminar el batching en memoria. Cada click se escribe directamente a Firestore en el momento en que ocurre**, con una única llamada `FieldValue.increment(1)` por click, fire-and-forget (el `302` no espera la escritura), igual que hoy. Esto elimina por completo la necesidad de estado en memoria persistente entre requests para el conteo de clicks, y por lo tanto elimina la razón de negocio que sostenía `min_instances: 1`. `app.yaml` vuelve a `min_instances: 0`.

Puntos ya decididos, no delegados al backend-engineer:

- **La firma pública del módulo `src/utils/click-counter.js` no cambia**: sigue exportando una función `increment(redirectId)` invocada desde `src/redirect/routes/redirect.router.js` exactamente como hoy. El único cambio de comportamiento vive dentro del módulo — pasa de acumular en un `Map` y hacer flush condicional, a ejecutar la escritura Firestore en cada llamada. Esto contiene el radio de impacto: el router del catch-all no se modifica.
- **`FieldValue.increment(1)` se mantiene** (no una transacción, no un `set` con lectura previa) — la razón dada en `v4.2.0` sigue aplicando sin cambios: es una escritura ciega y atómica, correcta para un contador distribuido, sin el costo de una lectura adicional por click.
- **El estado en memoria (`Map`, `FLUSH_THRESHOLD`, `flushAll()`, `getCounters()`) desaparece del módulo.** No hay contador local que drenar, por lo tanto no hay nada que hacer flush.
- **El handler `process.on('SIGTERM', ...)` en `src/app.js` se elimina**, no se deja como no-op. Su único propósito era invocar `clickCounter.flushAll()` para no perder conteos pendientes; sin estado en memoria, esa invocación no tiene nada que drenar. Dejarlo como no-op (una función vacía o un log sin acción) sería código muerto que un lector futuro tendría que investigar para confirmar que en efecto no hace nada — más deuda que valor. Si en el futuro surge otra razón para manejar `SIGTERM` (drenar conexiones abiertas, cerrar un listener, etc.), se añade entonces como una decisión nueva, no como resto de esta.
- **No es un feature flag ni una opción de configuración en runtime.** La comparación es entre dos implementaciones divergentes en dos ramas (`dev` vs `main`), no una opción conmutable — así lo pidió explícitamente el dueño del producto, y así se preserva `main` intacto como control/rollback inmediato.

### Trade-off aceptado

Bajo `min_instances: 0`, la primera request tras un período de inactividad paga un cold start (ya existente hoy, independiente de este cambio). Ese cold start no es nuevo: ya es el comportamiento actual de `dev` con `min_instances: 0` sin commitear. Este spec no lo introduce ni lo resuelve — solo dejó de estar "escondido" por `min_instances: 1`.

La pérdida de un click individual pasa a depender únicamente de que la escritura Firestore del catch-all tenga éxito en cada request — igual de fire-and-forget que hoy, pero ahora sin ventana de exposición de "hasta 9 clicks pendientes": cada click que sí llega a ejecutar `increment()` se escribe o se pierde de forma aislada, nunca arrastra otros 8 clicks consigo. Esto es una mejora de exactitud respecto al diseño de `v4.2.0`, no una regresión — dato relevante para la decisión de versión (ver más abajo).

## Alternativas consideradas y descartadas

- **Mantener `min_instances: 1` y el batching actual (statu quo).** Es exactamente la hipótesis contra la que se experimenta — no reduce costo, que es el problema a resolver.
- **Reducir el umbral de flush (p. ej. `FLUSH_THRESHOLD = 3`) en vez de eliminarlo.** Reduce la ventana de pérdida por crash pero no elimina la dependencia de que el `Map` sobreviva entre requests — con `min_instances: 0` el riesgo de perder conteos pendientes al escalar a cero sigue presente, solo que acotado a 2 clicks en vez de 9. No resuelve la causa raíz (el acoplamiento conteo↔infraestructura) y complica la comparación de costos del experimento al introducir una tercera variable a medio camino entre las dos arquitecturas que se quieren comparar.
- **Transacción Firestore (read-then-write) en vez de `FieldValue.increment`.** Descartada por la misma razón que en `v4.2.0`: añade una lectura y bloqueo temporal del documento por cada click, sin ningún beneficio sobre una escritura ciega atómica para este caso de uso.
- **Cola/buffer externo durable (Cloud Tasks, Pub/Sub) para seguir agrupando escrituras sin depender de `min_instances`.** Descartada: introduce infraestructura nueva con su propio costo y complejidad operativa, violando la restricción de `v4.2.0` ("sin infraestructura nueva") que sigue vigente, y contradice el propósito del experimento — comparar dos arquitecturas simples, no añadir una tercera pieza al costo total.
- **Feature flag/config runtime para alternar entre batching y escritura directa.** Descartada explícitamente por decisión de producto: la comparación debe darse entre dos ramas con implementaciones divergentes (`dev` vs `main`), no una opción activable en el mismo despliegue — evita que ambigüedad de configuración contamine la medición de costo real.

## Criterio de éxito / fracaso del experimento

**Duración sugerida del período de prueba:** un ciclo de facturación completo (mínimo 2-4 semanas de tráfico real en `dev` desplegado a producción), para que la comparación de costo no esté sesgada por un pico o valle atípico de tráfico.

**Métricas a comparar** (Cloud Billing / consola de costos de GCP, desglosado por SKU):

| Arquitectura | Costo relevante a medir |
|---|---|
| `main` (control): batching + `min_instances: 1` | Instance-hours de App Engine (SKU de cómputo F1) + escrituras Firestore (1 por cada 10 clicks, redondeando al alza) |
| `dev` (experimento): escritura directa + `min_instances: 0` | Escrituras Firestore (1 por click) + instance-hours de App Engine bajo demanda (solo mientras hay tráfico, más cold starts) |

**Éxito:** el costo total del período de prueba bajo la arquitectura de `dev` (escrituras Firestore por click + cómputo bajo demanda) es menor que el costo que hubiera tenido `main` bajo el mismo tráfico real (cómputo `min_instances: 1` + escrituras batched). Cuando el resultado es favorable, se hace merge de `dev` a `main` y se tagea como release normal (ver "Impacto en versión" abajo).

**Fracaso:** el costo total es igual o mayor, o la comparación no es concluyente por volumen de tráfico insuficiente para diferenciar ambas arquitecturas. Cuando el resultado es desfavorable, no se hace merge — `main` conserva la implementación de `v4.2.0` (batching + `min_instances: 1`) como versión de producción, y el experimento en `dev` queda documentado como fallido (ver plan de reversión).

No se define un criterio de fracaso por pérdida de datos o degradación de latencia: la escritura sigue siendo fire-and-forget fuera del camino crítico del `302`, así que no hay impacto de latencia esperado; y la pérdida de clicks individuales aislados es aceptada bajo el mismo criterio de "analytics personal" que `v4.2.0` ya estableció.

## Plan de reversión

Si el resultado es fracaso:

- No se hace merge de `dev` a `main`. `main` no se toca — sigue siendo la versión de producción con batching + `min_instances: 1`, sin necesidad de ningún commit adicional de reversión sobre `main`.
- `dev` puede resetearse al estado de `main` (`git reset` o merge inverso) si se quiere seguir desarrollando sobre la arquitectura de batching, o conservarse tal cual con este spec y su plan marcados como `Estado: EXPERIMENTO FALLIDO — no mergeado`, a criterio de quien cierre el experimento. En cualquier caso, el spec y el plan de este experimento no se borran — quedan como registro de la decisión y su resultado, consistente con el resto de `docs/spec/` y `docs/plan/` del repositorio.
- Si `dev` ya fue desplegado a producción durante el período de prueba (ver alcance abajo) y el resultado es fracaso, el siguiente despliegue debe volver a desplegar el estado de `main` (batching + `min_instances: 1`) a producción.

## Alcance temporal y de rama

- Este cambio se implementa y se despliega **solo en `dev`**, que durante el período de prueba es lo que se despliega a producción.
- `main` permanece intacto con la implementación de `v4.2.0` (batching + `min_instances: 1`) como control y ruta de rollback inmediato durante todo el experimento.
- El cierre del experimento (merge a `main` + tag, o descarte) no está en el alcance de este spec — es una decisión posterior, tomada con los datos de costo reales en mano.

## Impacto en versión (GENERACIÓN.FEATURE.PATCH)

Este cambio es **PATCH**, no FEATURE ni GENERACIÓN:

- No hay contrato de API nuevo ni modificado: `GET /api/v1/redirects` y `GET /api/v1/redirects/:id` siguen devolviendo `clickCount` exactamente igual que hoy — el campo, su tipo, y su semántica ("total de clicks del redirect") no cambian para ningún consumidor de la API.
- No hay funcionalidad nueva visible para el usuario final ni para el usuario interno (owner de un redirect): sigue viendo un contador de clicks, ahora con una exactitud igual o mejor (sin la ventana de hasta 9 clicks pendientes de `v4.2.0`), pero esa mejora es un detalle de implementación de la infraestructura de conteo, no una capacidad nueva expuesta al caller.
- Es un refactor interno de `src/utils/click-counter.js` y de `src/app.js` (retiro de un handler muerto) más un ajuste de configuración de despliegue (`app.yaml`) — exactamente la categoría "refactors — no behavior change visible to users" de la tabla de versionado del CLAUDE.md.
- **Precedente directo:** el hotfix de `trust proxy` (commit `cebf1ae`, `docs/plan/2026-09-07_01_hotfix-trust-proxy-rate-limit.md`) — un cambio de configuración interna sin funcionalidad nueva — se versionó como PATCH (`4.2.0` → `4.2.1`).

**Versión objetivo si el experimento tiene éxito y se hace merge a `main`:** `4.2.2` (siguiente PATCH sobre la versión actual `4.2.1`), asumiendo que ningún otro PATCH se intercala antes del cierre del experimento — el docs-engineer que cierre el experimento debe confirmar la versión vigente en `package.json` de `main` en ese momento antes de fijar el número final. El bump de versión **no se ejecuta en este spec ni en su plan de implementación** — se ejecuta en el commit de cierre del experimento, condicionado al resultado (ver "Plan de reversión" y "Criterio de éxito / fracaso").

## Archivos afectados

| Archivo | Cambio | Tipo |
|---|---|---|
| `src/utils/click-counter.js` | Reemplaza el `Map` + umbral + `flushAll`/`getCounters` por una escritura directa `FieldValue.increment(1)` por llamada a `increment(redirectId)`; firma pública sin cambios | Non-breaking (interno) |
| `src/app.js` | Elimina el handler `process.on('SIGTERM', ...)` y el import de `clickCounter` que solo existían para el flush del `Map` | Non-breaking (interno) |
| `src/redirect/routes/redirect.router.js` | Ninguno — el call site `clickCounter.increment(id)` no cambia | N/A |
| `app.yaml` | `min_instances: 1` → `min_instances: 0` | Non-breaking (infraestructura) |
| `src/utils/__test__/click-counter.test.js` | Reescribir para cubrir el nuevo comportamiento; retirar casos de umbral/`flushAll`/`getCounters` | N/A (test) |
| `CLAUDE.md` | Sección "Caching" / Click counter — reflejar escritura directa por click y ausencia de `min_instances: 1` como requisito | N/A (docs) |

## Referencias

- Plan de implementación: `docs/plan/2026-09-10_01_click-counter-direct-write-experiment.md`
- Spec original del conteo de clicks: `docs/spec/2026-06-28_01_v4.2.0.md`
- Precedente de versionado PATCH para cambio de configuración interna: `docs/plan/2026-09-07_01_hotfix-trust-proxy-rate-limit.md`
- Commit que introdujo `min_instances: 1`: `591b7cf`

## Resultado del experimento (2026-11-20)

La factura de GCP del período de prueba confirmó que el gasto **disminuyó** con la arquitectura de `dev` (escritura directa por click + `min_instances: 0`) respecto a la de `main` (batching en memoria + `min_instances: 1`). Se cumple el criterio de éxito: el experimento se mergea a `main` y se publica como `v4.2.2` (PATCH; ver "Impacto en versión"). Ningún otro PATCH se intercaló antes del cierre, así que la versión objetivo se mantiene.

## Open questions

- [x] ¿Cuál es la duración exacta del período de prueba antes de tomar la decisión de merge/descarte? Este spec sugiere 2-4 semanas pero la decisión final depende de quién revisa el billing de GCP. **Resuelto:** se evaluó con la factura completa del período, ya disponible al 2026-11-20.
- [x] ¿Quién es responsable de revisar Cloud Billing al cierre del período de prueba y documentar el resultado (éxito/fracaso) en este spec? **Resuelto:** el dueño del producto revisó la factura y reportó el resultado (ver "Resultado del experimento").
