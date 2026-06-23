# Runbook: Aumentar el límite de grupos por usuario por encima de 10

## Cuándo usar este runbook

Cuando sea necesario elevar la cota `.max(10)` del campo `groups` en `user.schema.js` a un valor superior. El límite actual es 10 porque el operador `array-contains-any` de Firestore acepta un máximo de 10 valores. Superarlo rompe el query de `GET /api/v1/redirects` para usuarios no-admin con grupos.

No uses este runbook si solo quieres entender la restricción — lee §0.1 del spec `docs/spec/2026-06-10_01_v4.md`.

---

## Archivos a modificar

### 1. `src/api/users/schemas/user.schema.js`

Cambia `.max(10)` al nuevo límite deseado:

```js
// Antes:
const groups = Joi.array().items(Joi.string()).max(10);

// Después (ejemplo: nuevo límite = 50):
const groups = Joi.array().items(Joi.string()).max(50);
```

Este cambio aplica simultáneamente a `createUserSchema` y `updateUserByAdminSchema` porque ambos reutilizan la variable `groups`.

### 2. `src/api/redirect/services/redirect.service.api.js`

Implementar el método `findByPermissions(email, groups, options)` con batching transparente. El handler de `GET /api/v1/redirects` debe llamar a este método en lugar de construir el `Filter.or()` directamente.

---

## Implementación de `findByPermissions`

```js
/**
 * Busca redirects visibles para un usuario dado su email y sus grupos.
 * Cuando groups.length > 10, divide en batches de 10 para respetar
 * el límite de array-contains-any de Firestore.
 *
 * @param {string} email
 * @param {string[]} groups  - slugs de grupos del usuario
 * @param {object} options   - { orderBy, offset, limit }
 * @returns {Promise<Redirect[]>}
 */
async findByPermissions(email, groups, options = {}) {
  const { orderBy = '-updated', offset = 0, limit } = options;

  // Sin grupos: query simple por owner
  if (groups.length === 0) {
    return this.find({ filters: [['owner', '==', email]] }, { orderBy, offset, limit });
  }

  const readPermissions = groups.map(g => `read:${g}`);

  // Un solo batch: comportamiento idéntico al handler original
  if (readPermissions.length <= 10) {
    const filter = Filter.or(
      Filter.where('owner', '==', email),
      Filter.where('permission', 'array-contains-any', readPermissions)
    );
    return this.find({ filter }, { orderBy, offset, limit });
  }

  // Múltiples batches: ejecutar en paralelo, mergear en memoria
  const batches = chunk(readPermissions, 10); // ver implementación de chunk más abajo
  const ownerFilter = Filter.where('owner', '==', email);

  const snapshots = await Promise.all(
    batches.map(batch => {
      const permFilter = Filter.where('permission', 'array-contains-any', batch);
      // Sin offset/limit: cada sub-query trae todos sus documentos;
      // el slice se aplica sobre el merge final.
      return this.db.collection
        .where(Filter.or(ownerFilter, permFilter))
        .orderBy('updated', 'desc')
        .get();
    })
  );

  // Merge + deduplicar por id
  const seen = new Set();
  const docs = [];
  for (const snap of snapshots) {
    for (const doc of snap.docs) {
      if (!seen.has(doc.id)) {
        seen.add(doc.id);
        docs.push(this.docParser(doc));
      }
    }
  }

  // Re-ordenar el merge (el merge de N arrays ordenados no es globalmente ordenado)
  sortInMemory(docs, orderBy);

  // Slice para paginación
  return limit ? docs.slice(offset, offset + limit) : docs.slice(offset);
}
```

### Utilidades necesarias

```js
/**
 * Divide un array en sub-arrays de tamaño máximo `size`.
 */
function chunk(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

/**
 * Ordena un array de modelos en memoria según la convención de CrudService
 * (prefijo "-" = descendente).
 */
function sortInMemory(docs, orderBy = '-updated') {
  const desc = orderBy.startsWith('-');
  const field = desc ? orderBy.slice(1) : orderBy;
  docs.sort((a, b) => {
    if (a[field] < b[field]) return desc ? 1 : -1;
    if (a[field] > b[field]) return desc ? -1 : 1;
    return 0;
  });
}
```

### Cambio en el handler de `GET /api/v1/redirects`

Reemplazar la construcción manual del `Filter.or()` en el handler:

```js
// Antes (construcción manual en el handler):
const readPermissions = req.user.groups.map(g => `read:${g}`);
const filter = req.user.groups.length > 0
  ? Filter.or(
      Filter.where('owner', '==', email),
      Filter.where('permission', 'array-contains-any', readPermissions)
    )
  : Filter.where('owner', '==', email);
const redirects = await redirectServiceApi.find({ filter }, options);

// Después (delegado al servicio):
const redirects = await redirectServiceApi.findByPermissions(
  req.user.email,
  req.user.groups,
  options
);
```

---

## Índices Firestore afectados

No se requieren índices nuevos. Cada sub-query del batch usa los mismos índices compuestos que el query original:

- `redirects`: `owner ASC + updated DESC`
- `redirects`: `permission CONTAINS + updated DESC`

Ambos están declarados en `firestore.indexes.json` desde §1.4.

---

## Implicaciones de costo

| Grupos del usuario | Queries a Firestore | Documentos leídos |
|--------------------|--------------------|--------------------|
| 0                  | 1                  | Solo resultados paginados |
| 1–10               | 1                  | Solo resultados paginados |
| 11–20              | 2 (paralelas)      | Todos los redirects visibles (sin paginar en Firestore) |
| 21–30              | 3 (paralelas)      | Ídem |
| N                  | ceil(N/10)         | Ídem |

Cuando hay más de un batch, Firestore devuelve todos los documentos visibles para cada sub-query antes de la paginación en memoria. Para volúmenes bajos (cientos de redirects por usuario) esto es aceptable. Para volúmenes altos, considerar cursor-based pagination o una arquitectura de fan-out diferente.

---

## Tests a añadir

En `src/api/redirect/services/__test__/redirect.service.api.test.js`:

```
describe('findByPermissions')
  - usuario sin grupos: emite una sola query where('owner', '==', email)
  - usuario con 1–10 grupos: emite una sola query Filter.or
  - usuario con 11 grupos: emite dos queries en paralelo, mergea y deduplica por id
  - usuario con 21 grupos: emite tres queries
  - deduplicación: un redirect que aparece en dos batches solo aparece una vez en el resultado
  - ordenamiento: el resultado final está ordenado por updated desc independientemente de la cantidad de batches
  - paginación: offset y limit se aplican correctamente sobre el merge
```

---

## Checklist de cambios

- [ ] Actualizar `.max(N)` en `src/api/users/schemas/user.schema.js`
- [ ] Implementar `findByPermissions` en `src/api/redirect/services/redirect.service.api.js`
- [ ] Actualizar el handler de `GET /api/v1/redirects` en `src/api/redirect/routes/redirect.route.api.js`
- [ ] Añadir tests en `src/api/redirect/services/__test__/redirect.service.api.test.js`
- [ ] Actualizar §0.1 del spec para reflejar el nuevo límite y eliminar la advertencia si se implementó el batching
