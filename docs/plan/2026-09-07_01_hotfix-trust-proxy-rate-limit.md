# Plan — Hotfix: configurar `trust proxy` para el rate limiter del catch-all

**Fecha:** 2026-09-07
**Estado:** CERRADO
**Rama:** `hotfix-trust-proxy-rate-limit`
**Diagnóstico de referencia:** `docs/diag/2026-09-07_01_trust-proxy-rate-limit-misconfig.md`

---

## Contexto

Express no tiene configurado `trust proxy` (`src/app.js`). App Engine estándar coloca la instancia detrás de un único proxy inverso (el Google Front End), que añade `X-Forwarded-For` y `Forwarded` a cada request. Sin `trust proxy`, Express calcula `req.ip` a partir de `request.socket.remoteAddress` — la IP interna del GFE, igual para todo el tráfico — en vez de la IP real del cliente. El rate limiter del catch-all (`src/redirect/routes/redirect.router.js`, 60 req/min) usa el `keyGenerator` por defecto de `express-rate-limit` (`request.ip`), así que efectivamente no distingue clientes reales. Esto también genera el par de `ValidationError` (`ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`, `ERR_ERL_FORWARDED_HEADER`) que domina el 100% de los logs de error en producción.

---

## Decisión arquitectónica (resuelta, no delegada al backend-engineer)

**Agreed solution:**

- **Valor de `trust proxy`:** `1` (un único hop confiable), no `true` y no una función custom.
  - `true` queda descartado: dispara `ERR_ERL_PERMISSIVE_TRUST_PROXY` en el propio `express-rate-limit` (confirmado en `node_modules/express-rate-limit/dist/index.cjs:361-367`) porque confía en una cadena arbitraria de proxies, permitiendo spoofing de IP vía `X-Forwarded-For` anteponiendo valores falsos.
  - `1` coincide exactamente con la topología real de App Engine estándar sin LB/CDN adicional delante (confirmado en `app.yaml`: solo `handlers` con `secure: always`, sin balanceador externo configurado) — un solo hop, el GFE.
  - `1` resuelve ambos `ValidationError` originales: Express deja de tomar `req.ip` de `request.socket.remoteAddress` y lo calcula desde `X-Forwarded-For`/`Forwarded`, que es exactamente lo que ambos validadores comprueban.
  - No se requiere `keyGenerator` custom en el rate limiter — el default (`request.ip`) vuelve a ser correcto una vez que Express resuelve `req.ip` desde el hop confiable.

- **Dónde vive la configuración:** el valor debe depender del entorno, no ser fijo, porque en desarrollo local no existe ningún proxy real delante del proceso Node — confiar en un hop ahí sería aceptar `X-Forwarded-For` sin que ningún proxy real lo esté verificando (bajo riesgo dado que dev no es internet-facing, pero incorrecto como principio y contrario a la topología real).
  - **Producción** (`NODE_ENV=production`, App Engine): `trust proxy = 1`.
  - **Desarrollo y test** (`NODE_ENV` distinto de `production`): `trust proxy = false` (el default de Express) — no hay proxy real, y en `test` el rate limiter ya se salta explícitamente (`skip: () => process.env.NODE_ENV === 'test'`), así que el valor es irrelevante para el suite de Jest.
  - El valor condicional se calcula en `src/config/index.js`, siguiendo el mismo patrón ya usado ahí para `config.dev` y `config.cors` (lógica derivada de `NODE_ENV`, expuesta como propiedad de config en vez de repetirse inline). `src/app.js` debe limitarse a leer `config.trustProxy` (o el nombre de propiedad que el backend-engineer considere consistente con el resto de `config/index.js`) y pasarlo a `app.set('trust proxy', ...)`.
  - No se introduce ninguna variable de entorno nueva (`TRUST_PROXY` o similar) en `.env.example` / tabla de "Environment Variables" de CLAUDE.md: la topología de App Engine estándar es un hecho fijo de la arquitectura de despliegue, no un parámetro que un operador deba poder ajustar por instancia. Si en el futuro se introduce un Cloud Load Balancing o CDN delante de App Engine, este valor deberá revisarse como una nueva decisión arquitectónica, no como un ajuste de variable de entorno.

---

## §1 ✅ — Fix: configurar `trust proxy` en el bootstrap de Express

**Archivos:** `src/app.js`, `src/config/index.js`

El backend-engineer debe:

- Añadir a `src/config/index.js` el valor condicional de `trust proxy` descrito en la sección "Decisión arquitectónica" — `1` cuando `NODE_ENV === 'production'`, `false` en cualquier otro caso — expuesto como propiedad de config, siguiendo el estilo ya usado para `config.dev` / `config.cors` en ese mismo archivo.
- Llamar a `app.set('trust proxy', ...)` en `src/app.js` usando ese valor de config, antes de que se monte cualquier router (en particular, antes de `redirectRoute(app)`, que es donde vive el rate limiter afectado). Debe quedar cerca de la inicialización de `cors`/`helmet` al inicio del archivo, no intercalado entre routers.
- No tocar `express-rate-limit` ni su configuración (`windowMs`, `limit`, `keyGenerator`) en `src/redirect/routes/redirect.router.js` — el default `keyGenerator` (`request.ip`) es correcto una vez que `trust proxy` está bien configurado; no hay necesidad de un `keyGenerator` custom.
- No introducir ninguna variable de entorno nueva ni tocar `.env.example`.

Restricciones de diseño:

- El valor en producción debe ser exactamente `1` (entero), nunca `true`, `'1'` (string) ni un array/función — Express y `express-rate-limit` tratan el tipo numérico de forma distinta a la cadena o al booleano.
- La lógica condicional por entorno vive en `src/config/index.js`, no como un `if (config.dev)` inline dentro de `src/app.js` — mantiene el patrón existente de centralizar decisiones derivadas de `NODE_ENV` en config.

**Commit esperado:**

```
[fix] configure trust proxy for App Engine single-hop topology

plan: 2026-09-07_01_hotfix-trust-proxy-rate-limit §1
- trust proxy value (1 in production, false otherwise) added to src/config/index.js
- app.set('trust proxy', ...) added in src/app.js before router mounts

Used agents: backend-engineer
```

---

## §2 ✅ — Tests: cubrir la configuración de `trust proxy` y el rate limiter con IP real

**Archivos:** `src/config/__test__/` (o ubicación equivalente si `config/index.js` no tiene aún carpeta `__test__` — el test-engineer debe verificar la convención existente antes de crear una nueva), `src/redirect/routes/__test__/redirect.route.test.js`

El test-engineer debe:

- Verificar que `config` expone el valor correcto de `trust proxy` bajo `NODE_ENV=production` (`1`) y bajo cualquier otro valor de `NODE_ENV` (`false`). Si `config/index.js` no tiene tests previos por depender de variables de entorno leídas al importar el módulo, seguir el patrón que ya use el repo para testear módulos de config sensibles a `NODE_ENV` (revisar tests existentes antes de inventar uno nuevo).
- Añadir un caso al suite del catch-all (`src/redirect/routes/__test__/redirect.route.test.js`) que confirme que, con `trust proxy` configurado a `1`, `req.ip` resuelto por Express corresponde a la IP del cliente real llevada en `X-Forwarded-For` — esto es lo que garantiza que el rate limiter identifica clientes distintos correctamente.
- No es necesario un test end-to-end contra Firestore real para este caso — puede cubrirse a nivel de request/response simulada (supertest), consistente con el resto de `redirect.route.test.js`.
- Mantener los tests existentes; no eliminar cobertura previa del catch-all.

> **Corrección post-implementación (ver commit `0a2af72`):** este apartado pedía originalmente un escenario con dos IPs en `X-Forwarded-For` (formato `"<ip-cliente>, <ip-gfe>"`), asertando que `req.ip` resolvía a la primera. Al implementarlo se verificó empíricamente (Express + supertest reales, con `trust proxy: 1`) que ese header de dos IPs resuelve `req.ip` a la **segunda** IP, no a la primera — y que además no representa la topología real de App Engine: el GFE conecta por TCP directo y nunca se antepone a sí mismo dentro de `X-Forwarded-For`, así que el header real que llega a la instancia trae una única IP, la del cliente. El escenario se corrigió a una sola IP en `X-Forwarded-For`, consistente con la topología real, y así quedó implementado.

**Commit esperado:**

```
[test] cover trust proxy config and real-IP resolution in rate limiter

plan: 2026-09-07_01_hotfix-trust-proxy-rate-limit §2
- trust proxy value coverage in src/config/__test__/
- X-Forwarded-For real-IP resolution case in src/redirect/routes/__test__/redirect.route.test.js

Used agents: test-engineer
```

---

## §3 ✅ — Docs: cerrar diagnóstico y plan, actualizar CLAUDE.md, bump de versión

**Archivos:**

- `src/app.js` — si el docs-engineer determina que el `app.set('trust proxy', ...)` amerita un comentario inline explicando la topología de App Engine (un solo hop GFE) y por qué no se usa `true`, debe añadirlo junto a la llamada.
- `docs/diag/2026-09-07_01_trust-proxy-rate-limit-misconfig.md` — marcar `Estado: RESUELTO`, añadir referencia al commit de §1.
- `docs/plan/2026-09-07_01_hotfix-trust-proxy-rate-limit.md` (este archivo) — marcar los tres pasos como completados, `Estado: CERRADO`.
- `CLAUDE.md` — sección "Surface 3 — Redirect catch-all": el diagrama del pipeline debe reflejar que el rate limiter ahora identifica IP real de cliente vía `trust proxy`. Considerar si amerita una línea nueva en la sección de arquitectura general (bootstrap de `src/app.js`) documentando `app.set('trust proxy', ...)` como parte del bootstrap, junto a `cors`/`helmet`.
- `package.json` — bump de versión de parche (`4.2.0` → `4.2.1`), consistente con la convención GENERACIÓN.FEATURE.PATCH (este es un bug fix sin funcionalidad nueva visible al usuario).

El docs-engineer no debe modificar la sección de "Environment Variables" de CLAUDE.md — esta decisión se resolvió explícitamente como configuración interna derivada de `NODE_ENV`, no como variable de entorno nueva (ver "Decisión arquitectónica" arriba).

**Commit esperado:**

```
[docs] close trust proxy hotfix, update CLAUDE.md, bump to 4.2.1

plan: 2026-09-07_01_hotfix-trust-proxy-rate-limit §3
- Estado RESUELTO en docs/diag/2026-09-07_01_trust-proxy-rate-limit-misconfig.md
- Plan cerrado en docs/plan/2026-09-07_01_hotfix-trust-proxy-rate-limit.md
- CLAUDE.md actualizado: bootstrap de src/app.js y Surface 3
- Version bump en package.json

Used agents: docs-engineer
```

---

## Orden de ejecución

```
§1 [fix]  → §2 [test] → §3 [docs]
```

Cada paso produce un commit independiente. No mezclar producción, tests y docs en el mismo commit.

## Notas para el merge a `main`

Este hotfix se abre directamente desde `main` (no desde `dev`), siguiendo el patrón de hotfixes previos del repo (`docs/plan/2026-06-23_01_hotfix-api-404-json.md`, `docs/plan/2026-06-23_02_hotfix-patch-user-groups.md`). Al cerrar el plan, seguir el flujo de branch strategy de CLAUDE.md para el merge de vuelta a `main` y el tag de versión correspondiente (`v4.2.1`), no incluido en el alcance de este plan.
