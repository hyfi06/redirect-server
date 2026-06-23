# ADR — Comportamiento de revocación de API Keys: soft delete permanente + garbage collector futuro

**Fecha:** 2026-06-23
**Estado:** DECISIÓN TOMADA
**Tipo:** Architectural Decision Record

---

## 1. Contexto

Durante los tests end-to-end de v4.0.1 se observó que `DELETE /api/v1/users/me/api-keys/:keyId` no elimina el documento de Firestore — lo marca como `active: false` (revocación lógica). Los documentos de keys revocadas persisten indefinidamente en la subcollection `users/{userId}/apiKeys`.

Se analizó el impacto en storage, rendimiento e índices, y se evaluaron opciones de remediación.

---

## 2. Análisis de impacto

### Storage y rendimiento

| Factor | Impacto actual | Proyección a 1 año (1 usuario, 10 rotaciones/mes) |
|--------|---------------|--------------------------------------------------|
| Storage | ~600 bytes/doc | ~72 KB (120 docs) — irrelevante |
| `list()` sin filtro | Devuelve activas + revocadas | Degradación imperceptible a cientos de docs |
| Índice COLLECTION_GROUP `keyHash` | Incluye docs inactivos | O(log n) — sin impacto medible en este volumen |
| Conteo de activas en `create()` | `where('active', '==', true)` — correcto | Sin impacto |

### Seguridad

`authenticateApiKey` valida `active === false` antes de aceptar cualquier token:

```js
if (!result.apiKey.active) {
  return next(boom.unauthorized('API key revoked'));
}
```

Las keys revocadas son rechazadas con 401 aunque persistan en Firestore. No hay brecha de seguridad.

---

## 3. Decisión

**El comportamiento de soft delete (`active: false`) se mantiene de forma permanente** como estrategia de revocación. No se implementará hard delete en el flujo de `revoke()`.

### Razones

- El check de seguridad existe y funciona correctamente.
- El impacto en storage e índices es negligible a la escala actual y proyectada.
- El soft delete preserva `lastUsedAt` y el historial de keys para posibles auditorías futuras.
- Cambiar a hard delete eliminaría esa trazabilidad sin beneficio operativo real a esta escala.

---

## 4. Plan futuro: Garbage collector

En lugar de eliminar al revocar, se añadirá un **garbage collector** que limpie periódicamente documentos inactivos y expirados. Este componente queda pendiente para una versión futura (v4.x o v5).

### Alcance del garbage collector

El GC deberá eliminar documentos de `apiKeys` que cumplan cualquiera de estas condiciones:

| Condición | Campo a evaluar | Retención sugerida |
|-----------|----------------|-------------------|
| Key revocada | `active === false` | 30 días desde revocación (requiere campo `revokedAt`) |
| Key expirada | `expiresAt !== null && expiresAt < now` | Inmediata o con buffer de 7 días |

### Cambios de datos requeridos para el GC

Para implementar el GC sobre keys revocadas, `revoke()` deberá añadir un campo `revokedAt: Timestamp` al marcar `active: false`. Este campo no existe actualmente — añadirlo es un prerequisito del GC, no del comportamiento actual.

Las keys expiradas ya tienen `expiresAt` — el GC puede operear sobre ese campo sin cambios de schema.

### Opciones de implementación del GC

- **Cloud Scheduler + Cloud Function**: tarea periódica (ej. diaria) que hace un batch delete de docs candidatos.
- **Firestore TTL policy**: campo `deletedAt` + TTL nativo de Firestore (eventual, hasta 24h de delay). Más simple pero menos control.
- **En-proceso al arrancar**: barrido al iniciar la instancia de App Engine. Simple pero no garantizado en arquitecturas serverless.

La elección entre estas opciones queda abierta para cuando se implemente.

---

## 5. Lo que NO cambia

- `DELETE /api/v1/users/me/api-keys/:keyId` sigue siendo revocación lógica (`active: false`).
- `GET /api/v1/users/me/api-keys` devuelve todas las keys del usuario (activas e inactivas). Si se quiere filtrar la vista, es una decisión de UX separada.
- El límite de 10 keys activas se calcula solo sobre `active: true` — las inactivas no cuentan.
- La invalidación de caché (`nodeCache.del(keyHash)`) en el mismo instancia sigue funcionando para best-effort de invalidación inmediata.

---

## 6. Referencias

- Análisis técnico: conversación de arquitectura, 2026-06-23
- Código relevante: `src/api/users/services/api-key.service.js` — `revoke()`
- Middleware: `src/middleware/authenticate.middleware.js` — `authenticateApiKey()`
- Tests E2E: verificación de revocación en producción, 2026-06-23
