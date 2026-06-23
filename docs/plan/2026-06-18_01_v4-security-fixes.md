# Plan — Security Fixes: PATCH path immutability

**Diag:** docs/diag/2026-06-18_01_v4-beta-security-review.md (Vuln 1 + Vuln 2)
**Rama:** dev
**Fecha:** 2026-06-18

---

## Objetivo

Cerrar dos vulnerabilidades confirmadas en el handler `PATCH /api/v1/redirects/:id`, ambas causadas porque el campo `path` es aceptado en el body de actualización sin los controles que sí se aplican en `POST /`:

- **Vuln 1 (Alta):** un usuario con permiso de edición puede cambiar el `path` de su redirect a cualquier valor arbitrario — incluyendo segmentos de grupos a los que no pertenece o paths de nivel raíz reservados para admins. Además, `updateRedirectSchema` define `path` con el tipo `slugPath` (sin `/` inicial), mientras que los paths almacenados tienen `/` inicial; un PATCH con nuevo path lo escribiría en formato incorrecto, haciendo el redirect permanentemente inalcanzable.
- **Vuln 2 (Media):** `CrudService.update()` no verifica unicidad; dos documentos pueden terminar con el mismo `path`, rompiendo silenciosamente uno de ellos.

---

## Decisión arquitectónica: `path` es inmutable post-creación

### Opción recomendada — `path` inmutable

Eliminar `path` de `updateRedirectSchema`. Al no aceptarse el campo en el body de PATCH, ningún check adicional (namespace ni unicidad) es necesario en el handler ni en el servicio. La lógica de POST se mantiene como única puerta de entrada para la creación de paths.

**Ventajas:**
- Resuelve Vuln 1 y Vuln 2 de forma definitiva con un cambio mínimo y de bajo riesgo.
- Elimina la asimetría entre `createRedirectSchema` (que construye el path con grupo) y `updateRedirectSchema` (que aceptaría un path sin construir). No hay que replicar la lógica de construcción `/{group}/{path}` en dos handlers.
- La inmutabilidad del path es una propiedad coherente con el producto: los redirects se comparten como URLs; cambiar el path rompe cualquier enlace existente. Esta restricción hace explícito un invariante que de todas formas debería cumplirse.
- No introduce código nuevo en rutas calientes — solo elimina una aceptación indebida.

**Desventaja:** si en el futuro se necesita reubicar un redirect (cambiar su path), habrá que eliminar el documento y crear uno nuevo. Este trade-off es aceptable dado el modelo de producto: el path es la identidad del redirect.

### Opción alternativa — mantener `path` patchable con enforcement completo

Mantener `path` en `updateRedirectSchema` y añadir en el handler PATCH:
1. Si `req.body.path` está presente y es distinto del path actual: aplicar las mismas reglas de namespace que POST (verificar grupo, pertenencia, slug en Firestore).
2. Antes de escribir: llamar a `getByPath(fullPath)` para verificar unicidad, eximiendo el caso en que el nuevo path sea igual al existente.
3. Corregir el formato: aplicar `/${group}/${path}` como lo hace POST, no pasar `path` del body directamente a Firestore.

**Por qué se rechaza:** duplica lógica compleja de POST en PATCH, introduce múltiples puntos donde una divergencia futura podría reabrir la vulnerabilidad, y requiere tests de cobertura equivalentes. El riesgo de regresión es materialmente mayor que el beneficio de permitir el renombrado de paths — especialmente cuando eliminar+recrear logra el mismo resultado.

---

## Pasos

### Paso 1 — [x] Eliminar `path` de `updateRedirectSchema`

**Archivo:** `src/api/redirect/schemas/redirect.schema.js`

Quitar el campo `path: slugPath` del objeto `updateRedirectSchema`. El schema resultante acepta únicamente `url`, `permission`, y `categories` — los únicos campos que son legítimamente mutables después de la creación.

Dejar el comentario `D11` que documenta la razón por la que `slugPath` no tiene `/` inicial — se usa en `createRedirectSchema` y la explicación sigue siendo válida para ese caso.

Criterio de aceptación: `validatorHandler(updateRedirectSchema, 'body')` rechaza con 400 cualquier body que incluya el campo `path`. Un body sin `path` sigue pasando la validación.

Tipo de commit: `[fix]`

---

### Paso 2 — [x] Verificar que `updateRedirectParser` descarta `path` si llegara a Firestore

**Archivo:** `src/api/redirect/parsers/redirect.parser.js`

Confirmar (sin cambiar si ya es correcto) que `updateRedirectParser` no incluye `path` en el objeto que entrega a Firestore. Si `path` está presente en el parser de actualización, eliminarlo.

Esta es una capa de defensa secundaria: aunque el schema ya rechaza `path` en el body, el parser no debería propagarlo aunque llegara — defense in depth contra cambios futuros al schema que pudieran reintroducir el campo accidentalmente.

Criterio de aceptación: el objeto retornado por `updateRedirectParser` nunca contiene la clave `path`, independientemente de lo que se le pase como entrada.

Tipo de commit: `[fix]` (solo si hay cambio; `[docs]` si solo se añade un comentario de defensa).

---

### Paso 3 — [x] Escribir tests para los dos cambios

**Archivo de tests:** `src/api/redirect/routes/__test__/redirect.route.api.test.js` (extender el archivo existente)
**Archivo de tests del parser:** `src/api/redirect/parsers/__test__/redirect.parser.test.js` (o el archivo existente al lado del parser)

Tests requeridos para el handler PATCH:

- `PATCH /api/v1/redirects/:id` con body `{ path: 'fc/new-path' }`: debe responder 400 (schema rechaza `path`).
- `PATCH /api/v1/redirects/:id` con body `{ url: 'https://example.com' }`: debe responder 200 (campo mutable, no regresión).
- `PATCH /api/v1/redirects/:id` con body `{ path: 'fc/new-path', url: 'https://example.com' }`: debe responder 400 (el campo `path` presente hace fallar la validación).

Tests requeridos para `updateRedirectParser`:

- Dado un objeto que incluye `path`, el parser retorna un objeto sin la clave `path`.
- Los campos `url`, `permission`, y `categories` sí se incluyen cuando se proporcionan.

Tipo de commit: `[test]`

---

## Verificación

Después de cada unidad, correr el suite completo:

```bash
npm test
```

Criterio de aceptación global:

| Unidad | Criterio |
|--------|----------|
| Paso 1 — schema | `PATCH` con `path` en el body responde 400; sin `path` responde 200 |
| Paso 2 — parser | `updateRedirectParser` nunca incluye `path` en su salida |
| Paso 3 — tests | Todos los tests nuevos pasan; ningún test existente regresiona |

---

## Notas para el backend-engineer

**Por qué no se modifica `CrudService.update()` para añadir unicidad:**

La solución elegida (inmutabilidad del campo `path`) resuelve Vuln 2 en la capa de validación, antes de que la petición llegue al servicio. Añadir un check de unicidad en `CrudService.update()` o en `RedirectServiceApi.update()` sería correcto si `path` fuera mutable, pero haría a `CrudService` consciente de una regla de negocio específica de los redirects, violando el principio de responsabilidad única de la capa base.

**El campo `path` en `updateRedirectParser`:**

Revisar `src/api/redirect/parsers/redirect.parser.js`. El parser de actualización aplica `cleanDocObject` para eliminar claves `undefined`. Si `path` está en el parser, un body sin él lo dejaría fuera (porque sería `undefined`), pero si el body incluye `path` (e.g., si el schema cambia en el futuro sin actualizar el parser), se escribiría en Firestore. Quitarlo explícitamente del parser cierra ese camino.

**Inmutabilidad del `owner` como patrón existente:**

El `owner` ya es inmutable: está explícitamente excluido de `updateRedirectParser` y no se acepta en `updateRedirectSchema`. El `path` sigue el mismo patrón. El backend-engineer puede usar ese precedente como guía.

**Commit sequence:**

| Paso | Tipo de commit |
|------|---------------|
| Paso 1 — schema | `[fix]` |
| Paso 2 — parser | `[fix]` o `[docs]` según si hay cambio de código |
| Paso 3 — tests | `[test]` |
