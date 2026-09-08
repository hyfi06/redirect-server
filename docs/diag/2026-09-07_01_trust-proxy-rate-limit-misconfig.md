# Diagnóstico — `trust proxy` sin configurar rompe el rate limiter del catch-all

**Fecha:** 2026-09-07
**Estado:** ABIERTO
**Severidad:** Media — no hay explotación confirmada, pero el rate limiting de la ruta pública (`GET /*`) probablemente no está identificando IPs reales; genera 100% de ruido en los logs de error
**Rama:** `hotfix-trust-proxy-rate-limit` (desde `main`)

---

## 1. Descripción del fallo

Revisando `npm run logs` (últimos 100 errores de GCP Cloud Logging), el 100% son este par de excepciones repitiéndose cada 1–2 horas:

```
ValidationError: The 'X-Forwarded-For' header is set but the Express 'trust proxy'
setting is false (default). This could indicate a misconfiguration which would
prevent express-rate-limit from accurately identifying users.
ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
    at Object.xForwardedForHeader (node_modules/express-rate-limit/dist/index.cjs:381:13)
    ...
    at Object.keyGenerator (node_modules/express-rate-limit/dist/index.cjs:811:20)

ValidationError: The 'Forwarded' header (standardized X-Forwarded-For) is set but
currently being ignored. Add a custom keyGenerator to use a value from this header.
ERR_ERL_FORWARDED_HEADER
    at Object.forwardedHeader (node_modules/express-rate-limit/dist/index.cjs:396:13)
```

**Frecuencia:** ambos errores aparecen juntos, cada 1–2h, de forma continua — no son picos aislados. El patrón coincide con tráfico normal llegando a través de App Engine, no con un ataque.

---

## 2. Causa raíz

**Archivo:** `src/app.js` — Express nunca llama a `app.set('trust proxy', ...)`.

**Archivo:** `src/redirect/routes/redirect.router.js:13-25` — el limiter (`express-rate-limit`, 60 req/min, ver CLAUDE.md "Surface 3") se monta en el catch-all `GET /*` sin `keyGenerator` custom, así que usa el default: `request.ip`.

App Engine estándar coloca la instancia detrás del **Google Front End (GFE)**, que actúa como único reverse proxy entre el cliente y la instancia Node. El GFE añade cabeceras `X-Forwarded-For` (IP real del cliente) y `Forwarded` a cada request antes de reenviarlo a la app. Esto se confirma en el propio código fuente de `express-rate-limit` instalado en el repo:

```js
// node_modules/express-rate-limit/dist/index.cjs
xForwardedForHeader(request) {
  if (request.headers["x-forwarded-for"] && request.app.get("trust proxy") === false) {
    throw new ValidationError("ERR_ERL_UNEXPECTED_X_FORWARDED_FOR", ...);
  }
}

forwardedHeader(request) {
  if (request.headers.forwarded && request.ip === request.socket?.remoteAddress) {
    throw new ValidationError("ERR_ERL_FORWARDED_HEADER", ...);
  }
}

trustProxy(request) {
  if (request.app.get("trust proxy") === true) {
    throw new ValidationError("ERR_ERL_PERMISSIVE_TRUST_PROXY", ...);
  }
}
```

Sin `app.set('trust proxy', ...)`, Express usa su default (`false`). Consecuencias, línea por línea:

- `xForwardedForHeader` dispara `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` porque la cabecera `X-Forwarded-For` está presente (la pone el GFE) pero `trust proxy` es `false` — Express ignora la cabecera y calcula `req.ip` a partir de `request.socket.remoteAddress`, que en App Engine es la IP interna del GFE, **la misma para todas las requests**.
- `forwardedHeader` dispara `ERR_ERL_FORWARDED_HEADER` por el mismo motivo: `req.ip === request.socket.remoteAddress` porque Express no está resolviendo la IP a partir de ninguna cabecera de proxy.

**Efecto en el rate limiter:** el `keyGenerator` por defecto de `express-rate-limit` es `request.ip`. Si `req.ip` es siempre la IP interna del GFE (idéntica para todo el tráfico entrante a la instancia), **todas las requests de todos los clientes comparten la misma key de rate limiting**. El límite de 60 req/min no se aplica por cliente real — se aplica al agregado de todo el tráfico que pasa por esa instancia. Un solo cliente abusivo puede agotar la cuota compartida y bloquear (`429`) a usuarios legítimos; o, si el volumen agregado nunca alcanza 60/min, ningún cliente individual es limitado sin importar cuántas requests haga.

**Por qué `true` no es la solución:** el propio validador `trustProxy()` confirma que `app.set('trust proxy', true)` dispara un tercer error, `ERR_ERL_PERMISSIVE_TRUST_PROXY`, precisamente porque confiar en *todos* los hops permite que cualquier cliente falsifique su IP real vía `X-Forwarded-For` (el cliente antepone valores arbitrarios que Express aceptaría como si vinieran de un proxy confiable).

**Confirmación de topología App Engine:** App Engine estándar (Node.js runtime) no interpone balanceadores de carga adicionales por defecto — no hay Cloud Load Balancing ni CDN configurado en `app.yaml` de este proyecto (solo `handlers: secure: always` con el manejo SSL nativo de App Engine). El único proxy inverso entre el cliente y la instancia es el GFE. Esto corresponde a **un único hop confiable** en la terminología de Express (`trust proxy: 1`), no una cadena arbitraria de hops.

---

## 3. Componentes afectados

| Componente | Archivo | Rol en el bug |
|---|---|---|
| Bootstrap de Express | `src/app.js` | No configura `trust proxy` — causa raíz |
| Rate limiter del catch-all | `src/redirect/routes/redirect.router.js` | Consumidor afectado: su `keyGenerator` por defecto (`req.ip`) no identifica IPs reales |
| Config centralizada | `src/config/index.js` | No expone ningún valor de `trust proxy`; ya contiene lógica condicional por entorno (`config.dev`, `config.cors`) que sirve de precedente para dónde debe vivir este nuevo valor |
| App Engine runtime | `app.yaml` | Confirma la topología: sin LB/CDN adicional delante del GFE — un solo hop |

No hay otros rate limiters ni middlewares en el repo que dependan de `req.ip` (verificado por búsqueda en `src/`).

---

## 4. Impacto

- **Rate limiting inefectivo en producción**: el límite de 60 req/min de la ruta pública `GET /*` no se aplica correctamente por IP de cliente real; se aplica —en el mejor caso— a la agregación de tráfico por instancia, o efectivamente no se aplica si el volumen agregado no alcanza el umbral.
- **Ruido operacional**: el 100% de los errores de las últimas horas en Cloud Logging son este par de `ValidationError`, ocultando cualquier error real que pudiera aparecer en el mismo periodo. `npm run logs` (solo ERROR+) queda contaminado.
- **Sin explotación confirmada**: no hay evidencia en los logs de que un actor esté abusando activamente del catch-all; el hallazgo es una falla de diseño detectada por revisión proactiva de logs, no un incidente reportado.
- **Sin impacto en `/api/v1/**`**: esas rutas no usan `express-rate-limit`; el bug está acotado al catch-all de redirects.
- **Sin impacto en tests**: el limiter se salta explícitamente en `NODE_ENV === 'test'` (`skip: () => process.env.NODE_ENV === 'test'`), así que el suite de Jest no ejercita este código y no detectó el problema.

---

## 5. Alcance de la solución

Cubierto en `docs/plan/2026-09-07_01_hotfix-trust-proxy-rate-limit.md`. Resumen de la decisión arquitectónica tomada (detalle completo en el plan):

**Agreed solution:** `app.set('trust proxy', 1)` en `src/app.js`, con el valor `1` calculado condicionalmente por entorno en `src/config/index.js` (mismo patrón ya usado para `config.dev` / `config.cors`) — `1` en producción, `false` en desarrollo/test, donde no existe ningún proxy real delante de la instancia.

Justificación de `1` sobre las alternativas:

| Opción | Resultado frente a los dos `ValidationError` | Riesgo |
|---|---|---|
| `false` (actual, default) | No resuelve ninguno de los dos | — (estado actual, roto) |
| `true` | Resuelve los dos originales, pero el propio `express-rate-limit` dispara un tercer error (`ERR_ERL_PERMISSIVE_TRUST_PROXY`) | Alto — confía en cadenas de proxies arbitrarias; un cliente puede spoofear su IP anteponiendo valores falsos a `X-Forwarded-For` |
| `1` | Resuelve los dos originales sin disparar `ERR_ERL_PERMISSIVE_TRUST_PROXY` (confirmado leyendo `node_modules/express-rate-limit/dist/index.cjs:361-401`) | Bajo — coincide exactamente con la topología real de App Engine estándar (un solo hop, el GFE) |
| Función custom | Igual resultado que `1` con más código que mantener, sin beneficio adicional dado que la topología es fija y conocida | Complejidad injustificada |

---

## 6. Referencias

- Logs de origen: `npm run logs` (GCP Cloud Logging, últimos 100 errores, 2026-09-07)
- `node_modules/express-rate-limit/dist/index.cjs` líneas 320-401 (validadores `xForwardedForHeader`, `forwardedHeader`, `trustProxy`)
- Express docs: `trust proxy` setting — valor numérico = "trust the nth hop from the front-facing proxy server as the client"
- `app.yaml` (este repo) — confirma ausencia de LB/CDN adicional delante de App Engine estándar
- CLAUDE.md — sección "Surface 3 — Redirect catch-all" (rate limiter existente) y "Environment Variables" (patrón de configuración por entorno)
