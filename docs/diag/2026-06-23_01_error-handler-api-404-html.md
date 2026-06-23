# Bug Report — `errorHandler` sirve HTML en lugar de JSON para rutas `/api/**`

**Fecha:** 2026-06-23
**Estado:** RESUELTO
**Severidad:** Alta — rompe el contrato de `docs/api/v1.md` para todos los clientes API
**Relacionado con:** `docs/diag/2026-06-10_05_error-handler-404-wrong-status.md` (bug distinto, mismo archivo)

---

## 1. Descripción del fallo

Todos los endpoints de `/api/v1/**` devuelven **HTML** (`NotFound.html`) cuando un recurso no existe, en lugar de JSON en formato Boom. El HTTP status code es correcto (404), pero el `Content-Type` y el cuerpo de la respuesta son incorrectos para un cliente API.

**Comportamiento observado:**

```
GET /api/v1/redirects/nonexistent-id
→ HTTP 404
→ Content-Type: text/html
→ <html>...<img src="/404.svg">...</html>
```

**Comportamiento esperado** (según `docs/api/v1.md §Errors`):

```
HTTP 404
Content-Type: application/json

{
  "statusCode": 404,
  "error": "Not Found",
  "message": "..."
}
```

**Detectado durante:** tests end-to-end en producción (2026-06-23).

---

## 2. Relación con el diagnóstico previo `2026-06-10_05`

El diagnóstico `2026-06-10_05` documentó que `errorHandler` servía `NotFound.html` con **HTTP 200** en lugar de 404. Ese bug fue corregido: se añadió `res.status(statusCode)` antes de `res.sendFile()`.

El presente bug es **distinto**:

| Aspecto | Bug anterior (resuelto) | Bug actual (pendiente) |
|---|---|---|
| Status HTTP | Incorrecto: 200 | Correcto: 404 |
| Content-Type | HTML (síntoma) | HTML (síntoma) |
| Cuerpo | HTML (síntoma) | HTML (síntoma) |
| Causa raíz | `res.sendFile()` sin `res.status()` | Handler no distingue rutas API de rutas browser |

El fix anterior era necesario y correcto. El presente bug requiere un fix diferente.

---

## 3. Causa raíz

**Archivo:** `src/middleware/error.handler.js`, función `errorHandler`

```
if (statusCode == 404) {
  res.status(statusCode).sendFile(NotFound.html)   ← sirve HTML siempre
} else if (statusCode == 500 && !config.dev) {
  res.status(statusCode).sendFile(serverError.html) ← sirve HTML siempre
} else {
  res.status(statusCode).json(...)                  ← solo alcanzable para otros status
}
```

El handler aplica una lógica de formato basada únicamente en el código de status HTTP: 404 → HTML, 500-prod → HTML, resto → JSON. No considera el origen de la petición ni el tipo de cliente esperado.

Para las rutas de browser (`GET /some-path`), este comportamiento es correcto: un usuario que visita una URL inexistente debe ver una página de error HTML.

Para las rutas de API (`/api/v1/**`), este comportamiento viola el contrato: `docs/api/v1.md` establece explícitamente que "All errors use the Boom format" y la introducción del documento declara "All endpoints return JSON."

El handler no tiene mecanismo para distinguir entre ambos contextos.

---

## 4. Alcance

El bug afecta a todos los endpoints que:

- Generan un `boom.notFound` (recurso inexistente) bajo `/api/v1/**`
- Generan un `boom.badImplementation` en producción bajo `/api/v1/**`

Endpoints afectados (no exhaustivo):

| Endpoint | Caso que provoca 404 |
|---|---|
| `GET /api/v1/redirects/:id` | ID no existe en Firestore |
| `PATCH /api/v1/redirects/:id` | ID no existe en Firestore |
| `DELETE /api/v1/redirects/:id` | ID no existe en Firestore |
| `GET /api/v1/users/:id` | ID no existe en Firestore |
| `PATCH /api/v1/users/:id` | ID no existe en Firestore |
| `DELETE /api/v1/users/:id` | ID no existe en Firestore |
| `GET /api/v1/groups/:id` | ID no existe en Firestore |
| `PATCH /api/v1/groups/:id` | ID no existe en Firestore |
| `DELETE /api/v1/groups/:id` | ID no existe en Firestore |

Los endpoints de la catch-all redirect (`GET /*`) deben mantener el comportamiento HTML: son rutas de browser.

---

## 5. Impacto

- **Contrato roto**: `docs/api/v1.md` establece que todos los errores siguen el formato Boom JSON. La respuesta HTML viola este contrato para 404 y para 500 en producción.
- **Clientes API**: cualquier cliente que reciba 404 e intente parsear el body como JSON falla. `JSON.parse("<html>...")` lanza SyntaxError. Los clientes basados en `fetch` o `axios` con `.json()` fallarán silenciosamente o lanzarán una excepción no relacionada con el error original.
- **Depuración**: los mensajes de error de Boom (`"message": "Redirect not found"`) son invisibles — el cliente solo recibe HTML.
- **Tests E2E**: los tests de contrato que verifican `Content-Type: application/json` en 404 fallan.

---

## 6. Archivos afectados

| Archivo | Rol |
|---|---|
| `src/middleware/error.handler.js` | Error handler — lógica de formato sin distinción API/browser |
| `src/middleware/__test__/error.handler.test.js` | Tests del error handler — cobertura incompleta: no prueba comportamiento distinto por ruta |

---

## 7. Resolución

**Fecha:** 2026-06-23
**Commit del fix:** `a350b8b` — [fix] errorHandler returns JSON for /api/** routes
**Descripción:** Se añadió detección de ruta API (`req.path?.startsWith('/api/')`) al inicio de `errorHandler`; las rutas API siempre reciben JSON Boom independientemente del status code; las rutas browser mantienen la lógica HTML preexistente.
