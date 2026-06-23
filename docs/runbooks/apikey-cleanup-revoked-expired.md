# Runbook: Limpieza de API Keys revocadas y expiradas

**Servicio:** `users/{userId}/apiKeys` (subcollection Firestore)  
**Decisión de diseño:** `docs/diag/2026-06-23_02_apikey-revoke-soft-delete-adr.md`  
**Estado:** Garbage collector pendiente de implementación — usar procedimiento manual mientras tanto

---

## Contexto

`DELETE /api/v1/users/me/api-keys/:keyId` revoca las API Keys con soft delete: marca `active: false` pero no elimina el documento. Las keys expiradas (`expiresAt < now`) tampoco se eliminan automáticamente. Ambos tipos de documentos se acumulan indefinidamente en la subcollection.

Esto es un comportamiento intencional documentado en el ADR de referencia. No hay riesgo de seguridad — el middleware `authenticateApiKey` rechaza keys con `active: false` y keys con `expiresAt` pasado. El impacto a escala actual (≤10 usuarios) es negligible en storage e índices.

Este runbook existe para cuando el volumen justifique una limpieza, o para guiar la implementación del garbage collector planificado.

---

## Procedimiento 1 — Limpieza manual puntual (disponible ahora)

Usar cuando se quiera limpiar documentos acumulados sin implementar el GC.

### 1.1 Identificar documentos candidatos

Requiere acceso a Firestore Console o `gcloud`. Candidatos a eliminar:

- **Revocadas:** `active == false`
- **Expiradas:** `expiresAt != null AND expiresAt < <fecha_actual>`

Desde Cloud Shell o local con credenciales configuradas:

```bash
# Listar keys inactivas de un usuario (sustituir USER_ID)
gcloud firestore documents list \
  "projects/redirect-1kg/databases/(default)/documents/users/USER_ID/apiKeys" \
  --format="json" \
  | jq '[.[] | select(.fields.active.booleanValue == false) | {id: .name, name: .fields.name.stringValue}]'
```

### 1.2 Eliminar documentos manualmente

```bash
# Eliminar un documento específico
gcloud firestore documents delete \
  "projects/redirect-1kg/databases/(default)/documents/users/USER_ID/apiKeys/KEY_DOC_ID"
```

Para eliminar en lote, usar un script Node.js puntual con el SDK de Firestore y un `WriteBatch`.

### 1.3 Verificar

```bash
# Confirmar que el documento ya no existe
gcloud firestore documents describe \
  "projects/redirect-1kg/databases/(default)/documents/users/USER_ID/apiKeys/KEY_DOC_ID"
# Debe retornar: NOT_FOUND
```

---

## Procedimiento 2 — Implementar el Garbage Collector (solución planificada)

Esta es la **primera solución a implementar** cuando se decida automatizar la limpieza. Sigue el diseño del ADR.

### Pre-requisito: añadir campo `revokedAt`

El GC necesita saber cuándo se revocó una key para aplicar el período de retención. Actualmente `revoke()` solo actualiza `active: false`.

**Cambio en `src/api/users/services/api-key.service.js`:**

```js
// En revoke(), sustituir:
await docRef.update({ active: false });

// Por:
await docRef.update({
  active: false,
  revokedAt: Firestore.Timestamp.now(),
});
```

Este cambio es retrocompatible: los documentos existentes sin `revokedAt` se tratan como "revocados en fecha desconocida" y el GC puede usar una política conservadora (ej. retener si `revokedAt` es null, o asignarles la fecha de la primera ejecución del GC).

### Alcance del GC

El GC debe eliminar documentos que cumplan cualquiera de estas condiciones:

| Tipo | Condición | Retención recomendada |
|------|-----------|-----------------------|
| Revocada | `active === false AND revokedAt < now - 30d` | 30 días desde revocación |
| Expirada (activa) | `expiresAt !== null AND expiresAt < now` | Inmediata o 7 días de buffer |
| Expirada (revocada) | `active === false AND expiresAt !== null AND expiresAt < now` | La condición más restrictiva aplica primero |

### Opciones de implementación

**Opción A — Cloud Scheduler + Cloud Function (recomendada)**

1. Crear una Cloud Function HTTP en Node.js que:
   - Haga un `collectionGroup('apiKeys')` query para encontrar candidatos.
   - Use `WriteBatch` para eliminaciones en grupos de ≤500 documentos.
   - Loguee el número de documentos eliminados.
2. Crear un Cloud Scheduler job que invoque la función diariamente (ej. 03:00 UTC).
3. Proteger el endpoint con un token secreto en el header o con autenticación de servicio.

**Opción B — Firestore TTL nativo**

1. Añadir campo `deleteAfter: Timestamp` al revocar (ej. `now + 30d`) y al expirar (ej. `expiresAt + 7d`).
2. Configurar una TTL policy en Firestore Console sobre el campo `deleteAfter` para la subcollection `apiKeys`.
3. Firestore elimina los documentos automáticamente (delay de hasta 24h).

Ventaja: cero código de infraestructura. Desventaja: sin control preciso del momento de eliminación ni logs de auditoría.

**Opción C — Barrido en arranque de la instancia**

No recomendada para App Engine serverless: las instancias pueden arrancar con alta frecuencia bajo carga y el barrido no está garantizado en idle.

### Verificación post-implementación

```bash
# Después de una ejecución del GC, verificar que no quedan candidatos
# (ajustar la fecha según la política de retención configurada)
gcloud firestore documents list \
  "projects/redirect-1kg/databases/(default)/documents/users/USER_ID/apiKeys" \
  --format="json" \
  | jq '[.[] | select(.fields.active.booleanValue == false)]'
# Debe retornar []
```

Revisar los logs de la Cloud Function en Cloud Logging para confirmar el número de documentos eliminados en cada ejecución.

---

## Notas operacionales

- **El índice COLLECTION_GROUP sobre `keyHash`** se actualiza automáticamente cuando se eliminan documentos — no requiere acción manual sobre índices.
- **La caché de 30s** (`nodeCache`) en `authenticateApiKey` no se ve afectada por la eliminación física: si una key ya fue revocada (`active: false`), ya fue rechazada en la primera request post-revocación y no debería estar en caché con un objeto `req.user` válido.
- **El límite de 10 keys activas** se calcula sobre `active: true` — la eliminación de documentos inactivos no afecta este conteo.
- Keys sin `revokedAt` (creadas antes de que se implemente el campo) deben tratarse con política conservadora en el GC: retener hasta que se pueda determinar una fecha de referencia, o eliminarlas solo si llevan inactivas más de N días medido desde `createdAt`.
