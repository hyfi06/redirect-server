# Runbook: Group ↔ User membership consistency check

**Servicio:** `PATCH /api/v1/groups/:id`  
**Síntoma:** La petición responde 500 con un error de sincronización de membresía visible en Cloud Logging:

```
[ERROR] Failed to add group <slug> to user <email>
[ERROR] Failed to remove group <slug> from user <email>
```

## Contexto

`GroupService.update()` sincroniza `User.groups` para los miembros añadidos/removidos mediante writes individuales. Si un write falla a mitad del loop, algunos usuarios quedan con `groups` actualizado y otros no. El documento del grupo siempre refleja el estado nuevo (es el último write), pero algunos usuarios pueden reflejar el estado anterior.

## Procedimiento

### 1. Identificar el grupo afectado

En Cloud Logging, localizar el mensaje de error. Contiene el `slug` del grupo y el `email` del usuario que falló.

Alternativamente, hacer `GET /api/v1/groups/:id` (admin) para obtener el estado actual del documento.

### 2. Determinar el diff esperado

El mensaje de error indica:
- `Failed to add group <slug> to user <email>` → el usuario **debería tener** `<slug>` en su campo `groups` pero puede no tenerlo.
- `Failed to remove group <slug> to user <email>` → el usuario **no debería tener** `<slug>` en su campo `groups` pero puede tenerlo.

El campo `Group.users` en Firestore refleja el estado **nuevo** (post-update). Úsalo como fuente de verdad para el estado deseado.

### 3. Verificar cada usuario del diff

Para cada email involucrado en la operación fallida:

```http
GET /api/v1/users/:id   (admin)
```

O directamente en Firestore Console → colección `users` → filtrar por `email`.

Revisar el campo `groups` del documento del usuario.

### 4. Detectar y corregir inconsistencias

| Caso | Síntoma | Corrección |
|---|---|---|
| Usuario añadido al grupo pero `User.groups` no incluye el slug | `groups` no contiene `<slug>` | Añadir `<slug>` a `User.groups` |
| Usuario removido del grupo pero `User.groups` todavía incluye el slug | `groups` contiene `<slug>` | Eliminar `<slug>` de `User.groups` |

**Vía API (recomendado):**

```http
PATCH /api/v1/users/:id
Authorization: Bearer <admin-jwt>
Content-Type: application/json

{ "groups": ["slug1", "slug2", ...] }
```

**Vía Firestore Console (si la API no está disponible):**

Ir a Firestore Console → colección `users` → documento del usuario → editar el campo `groups` directamente.

### 5. Verificar el resultado

```http
GET /api/v1/users/:id   (admin)
```

Confirmar que el campo `groups` contiene exactamente los slugs esperados.

### 6. Confirmar consistencia del grupo

```http
GET /api/v1/groups/:id   (admin)
```

Confirmar que el campo `users` del grupo coincide con el conjunto de emails que deberían pertenecer a él.

## Camino a largo plazo

La causa raíz es que los writes a `User.groups` no son atómicos. La solución definitiva es refactorizar `GroupService.update()` para usar Firestore batch writes, lo que requiere exponer una instancia compartida de `Firestore` en `FireStoreAdapter`. Documentado como deuda técnica para v4.
