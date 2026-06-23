# Bug Report — `errorHandler` sirve NotFound.html con HTTP 200 en lugar de 404

**Fecha:** 2026-06-10
**Estado:** PENDIENTE
**Severidad:** Media — comportamiento incorrecto observable, pero no impide la funcionalidad principal

---

## 1. Descripción del fallo

Cuando cualquier recurso no existe (grupo, usuario, redirect, etc.), el servidor devuelve el archivo `NotFound.html` con **HTTP 200** en lugar de **HTTP 404**.

**Comportamiento observado:**

```
HTTP/2 200
content-type: text/html; charset=UTF-8
...
<!DOCTYPE html>
<html><head></head><body></body></html>
```

**Comportamiento esperado:**

```
HTTP/2 404
content-type: text/html; charset=UTF-8
```

**Detectado durante:** smoke test de la API v1 en producción (2026-06-10). Los bloques de verificación 7.1–7.3 (`GET /:id` sobre recursos recién eliminados) devolvieron 200 en lugar de 404.

---

## 2. Causa raíz

**Archivo:** `src/middleware/error.handler.js`, línea 47

```js
// Antes (con el bug):
if (statusCode == 404) {
  res.sendFile(path.join(__dirname, '../views/NoFound/NotFound.html'));
}
```

`res.sendFile()` no hereda el código de estado del error — Express usa 200 por defecto si no se llama `res.status()` antes. El mismo patrón afecta la rama 500 en producción (línea 48–49), aunque ahí el impacto es menor porque los 500 en producción también deberían devolver status 500.

La rama `else` (línea 51) sí llama `res.status(statusCode)` correctamente — es el único caso que funciona bien.

---

## 3. Alcance

El bug afecta a todos los endpoints que generan un `boom.notFound` y a todos los que generan `boom.badImplementation` en producción:

| Caso | Status actual | Status correcto |
|---|---|---|
| Recurso no encontrado (404) | **200** | 404 |
| Error interno en producción (500) | **200** | 500 |
| Cualquier otro error (400, 401, 403…) | Correcto | — |

---

## 4. Fix propuesto

**Archivo:** `src/middleware/error.handler.js`, línea 47

```js
// Después:
if (statusCode == 404) {
  res.status(404).sendFile(path.join(__dirname, '../views/NoFound/NotFound.html'));
} else if (statusCode == 500 && !config.dev) {
  res.status(500).sendFile(path.join(__dirname, '../views/errorServer/serverError.html'));
} else {
  res.status(statusCode).json(withErrorStack(payload, err.stack));
}
```

Cambio mínimo: añadir `.status(statusCode)` antes de `.sendFile(...)` en ambas ramas HTML. La rama `else` ya lo hace correctamente y no necesita cambios.

---

## 5. Archivos afectados

| Archivo | Rol |
|---|---|
| `src/middleware/error.handler.js` | Error handler — líneas 47 y 48 con el bug |
| `src/middleware/__test__/error.handler.test.js` | Tests del error handler — verificar cobertura del status code |

---

## 6. Impacto en producción

- Los clientes que verifican el HTTP status code para detectar recursos inexistentes interpretan la respuesta como éxito (200).
- Los navegadores muestran la página de error correctamente (HTML visible), pero herramientas como curl, fetch, axios y cualquier cliente programático reciben un status incorrecto.
- El body HTML vacío (`<head></head><body></body>`) en `NotFound.html` sugiere además que el archivo podría estar incompleto o mal construido — verificar contenido real.
