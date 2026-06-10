# Plan: Preparación final para producción — v3-alpha

**Fecha:** 2026-06-09  
**Rama:** `v3-alpha`  
**Objetivo:** Cerrar los tres trabajos pendientes antes del despliegue a producción: cobertura de tests, documentación de la API, y entregable de despliegue.

---

## Workstream A — Tests faltantes

**Agente:** `test-engineer`  
**Commit objetivo:** `[test] add coverage for cache utils, root route, and config env validation`

### A1 — `src/utils/cache.js`

Sin test. Contiene `setClientCache(res, ttl)` y la instancia `nodeCache` usada por el redirect catch-all.

Archivo a crear: `src/utils/__test__/cache.test.js`
- `setClientCache` en `NODE_ENV=production` → llama `res.setHeader('Cache-Control', 'public, max-age=<ttl>')`
- `setClientCache` en otro entorno → no llama `setHeader`
- `nodeCache` exporta una instancia de NodeCache

### A2 — `src/routes/root.js`

Sin test. Monta `express.static` y sirve `index.html` en `GET /`.

Archivo a crear: `src/routes/__test__/root.route.test.js`
- `GET /` → 200 con contenido HTML
- `GET /1kg.svg` → 200 (archivo estático público)
- En `NODE_ENV=production` → header `Cache-Control` presente en `GET /`

Patrón de referencia: `src/routes/__test__/health.route.test.js`

### A3 — `src/config/index.js` líneas 6–12

El bloque de validación de env vars (`if (NODE_ENV !== 'test') { ... process.exit(1) }`) nunca se ejecuta en Jest.

Archivo a crear: `src/config/__test__/config.test.js`
- Con todas las vars requeridas presentes → no llama `process.exit`
- Con `JWT_SECRET` ausente → llama `process.exit(1)`
- `jest.spyOn(process, 'exit')` para interceptar; `jest.resetModules()` para forzar re-ejecución del módulo en cada test

---

## Workstream B — Documentación de la API

**Agente:** `docs-engineer`  
**Commit objetivo:** `[docs] REST API reference — v1 endpoints, schemas, and auth flow`

Archivo a crear: `docs/api/v1.md`

### Estructura

1. **Autenticación (OAuth2 + JWT)**
   - `GET /api/v1/auth/google` → inicia flujo OAuth2 con Google
   - `GET /api/v1/auth/google/callback` → devuelve `{ token, user }`
   - JWT payload: `{ userId, email, role, groups }` · HS256 · TTL configurable (default 2h)
   - Header en requests protegidos: `Authorization: Bearer <token>`

2. **Redirects** (`/api/v1/redirects`) — todos requieren JWT
   - `GET /` — admins ven todos; usuarios ven propios + `read:{group}` en permission
   - `GET /:id` — acceso verificado: admin ∨ owner ∨ `read:{group}` en permission
   - `POST /` — admins sin restricción de grupo; usuarios requieren grupo de pertenencia; `path` sin `/` inicial
   - `PATCH /:id` — solo owner o admin
   - `DELETE /:id` — solo owner o admin
   - Campo `permission`: `["read:{slug}", "edit:{slug}"]`

3. **Users** (`/api/v1/users`) — todos requieren JWT
   - `GET /` — admin only; paginación `offset`/`limit`
   - `GET /me` — cualquier usuario autenticado
   - `GET /:id` — admin only
   - `POST /` — admin only
   - `PATCH /:id` — admin: puede cambiar `role`/`groups`; usuario: solo `firstName`/`lastName`
   - `DELETE /:id` — admin only

4. **Groups** (`/api/v1/groups`) — todos requieren JWT
   - `GET /` — admins ven todos; usuarios ven solo sus grupos
   - `GET /:id` — miembros del grupo o admin
   - `POST /` — admin only; `slug` inmutable post-creación
   - `PATCH /:id` — admin only; `slug` no admitido en body
   - `DELETE /:id` — admin only

5. **Formato de errores** — `{ statusCode, error, message }`

---

## Workstream C — Entregable de despliegue

**Agente:** segundo `docs-engineer`

### C1 — `.gcloudignore`

**Commit:** `[chore] update .gcloudignore — exclude docs, tests, and dev config from deploy`

Añadir al `.gcloudignore` actual:

```
# Docs and dev guidance (not needed at runtime)
docs/
CLAUDE.md
.claude/

# Test files and test configuration
jest.config.js
src/**/__test__/
```

### C2 — `README.md`

**Commit:** `[docs] rewrite README — v3 changelog, env vars, deploy and Firestore index commands`

Reescribir el README con:
1. Descripción — 1kg.me URL shortener, Node 24, App Engine + Firestore
2. Changelog v3 — autenticación JWT+OAuth2, API REST, logging estructurado, health check
3. Prerrequisitos — Node >= 24, gcloud CLI, proyecto GCP con Firestore habilitado
4. Setup local — `npm install`, `cp .env.example .env`, `gcloud auth application-default login`, `npm run dev`
5. Variables de entorno:

| Variable | Descripción | Requerido | Default |
|---|---|---|---|
| `PORT` | Puerto del servidor | No | `3000` |
| `NODE_ENV` | Entorno (`development`/`production`/`test`) | No | — |
| `CORS` | Orígenes permitidos separados por coma | No | `*` |
| `JWT_SECRET` | Secreto para firmar y verificar JWTs (mínimo 32 chars recomendado) | **Sí** | — |
| `JWT_TTL` | Duración del token JWT (ej: `2h`, `1d`, `30m`) | No | `2h` |
| `GOOGLE_CLIENT_ID` | Client ID de la app en Google Cloud Console | **Sí** | — |
| `GOOGLE_CLIENT_SECRET` | Client Secret de la app en Google Cloud Console | **Sí** | — |
| `GOOGLE_OAUTH_REDIRECT` | URL de callback OAuth2 (ej: `https://1kg.me/api/v1/auth/google/callback`) | **Sí** | — |

> `JWT_SECRET` y `GOOGLE_CLIENT_SECRET` nunca deben escribirse en `app.yaml`.

6. Tests — `npm test`
7. Despliegue — `gcloud app deploy app.yaml`
8. Crear índices Firestore:

```bash
gcloud firestore indexes composite create \
  --collection-group=redirects \
  --field-config=field-path=owner,order=ASCENDING \
  --field-config=field-path=updated,order=DESCENDING

gcloud firestore indexes composite create \
  --collection-group=redirects \
  --field-config=field-path=permission,array-config=CONTAINS \
  --field-config=field-path=updated,order=DESCENDING

gcloud firestore indexes composite create \
  --collection-group=groups \
  --field-config=field-path=slug,order=ASCENDING \
  --field-config=field-path=updated,order=DESCENDING
```

9. API — enlace a `docs/api/v1.md`

---

## Verificación

```bash
npm test   # 515+ tests, sin regresiones
```
