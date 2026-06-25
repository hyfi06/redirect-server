# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Vision

**1kg.me** — a self-hosted URL shortener / redirect service running on Google Cloud (App Engine + Firestore), optimized for low cost under low traffic. Domain: `1kg.me`.

### Core product

A registered user can create a **redirect**: a short path (`1kg.me/some/path`) that resolves to a destination URL. Each redirect has:

- **owner** — the user who created it
- **categories** — string tags for personal organization
- **permission** — which groups can read or edit the redirect

### Users and groups

- Users are created exclusively by **admin** users (role `admin`).
- A user can belong to **multiple groups**.
- Groups are also managed by admins only.

### Path namespace rules

Every redirect path follows a namespace convention enforced at creation time:

| Who | Allowed path format | Example |
|---|---|---|
| Admin | `/{anything}` | `1kg.me/promo` |
| Regular user | `/{group-slug}/{path}` | `1kg.me/fc/seminar` |

- A regular user can only create paths under a group slug they belong to.
- The first segment of the path must match the `slug` of one of the user's groups.
- Admins can create paths at any level, including root-level paths.

### Group model

Groups have two fields relevant to paths:

| Field | Description | Example |
|---|---|---|
| `name` | Human-readable display name | `"Facultad de Ciencias"` |
| `slug` | Short URL segment, URL-safe | `"fc"` |

The `slug` is the segment used in redirect paths: `1kg.me/{slug}/{path}`.

### Permissions

Permissions live in `Redirect.permission: string[]`, entries formatted as `"read:{group}"`, `"edit:{group}"`, or `"delete:{group}"`.  
A redirect is visible to a requester if:
- The requester is the `owner`, OR
- The requester belongs to a group listed in `permission` with the `read` scope.

A redirect can be edited by the owner, an admin, or a user whose group appears in `permission` with the `edit` scope.  
A redirect can be deleted by the owner, an admin, or a user whose group appears in `permission` with the `delete` scope.

### Branch strategy

- `main` — production. Only the public redirect catch-all is live. No API, no auth.
- `dev` — active development. API v1 (`/api/v1/redirects`, `/api/v1/users`, `/api/v1/groups`) + auth complete. Not yet merged to main.

---

## Development Flow

### Full cycle — from spec to closed plan

```
[software-architect] write or update spec
        ↓ [docs] commit
[software-architect] write plan for one spec step (§x.y)
        ↓ [docs] commit
[backend-engineer]   implement the plan step
        ↓ [feat/fix/refactor/chore] commit
[test-engineer]      write tests for the new code
        ↓ [test] commit
[docs-engineer]      document new code inline; update spec and plan checkboxes
        ↓ [docs] commit
        ↓
  next plan step? → back to [backend-engineer]
  plan complete?  → [docs-engineer] closes the plan → [docs] commit
                    next spec step? → new plan → back to [software-architect]
                    spec complete?  → [docs-engineer] closes the spec → [docs] commit
```

### What counts as a unit of work

A unit is the smallest change that is complete and independently valuable:

- One sub-item of a plan step derived from a spec section (e.g. §1.1)
- A single bug fix
- A single refactor

Do not batch multiple plan steps into one cycle. Each step gets its own `[feat/fix/…] → [test] → [docs]` sequence.

### Agent responsibilities

| Step | Agent | Produces |
|---|---|---|
| Spec | `software-architect` | Spec file in `docs/spec/`, decisions documented, open questions resolved |
| Plan | `software-architect` | Plan file with numbered steps derived from one spec section |
| Code | `backend-engineer` | Working implementation, no regressions in test suite |
| Test | `test-engineer` | Tests covering all branches and edge cases of the new code |
| Docs | `docs-engineer` | Inline JSDoc where required; CLAUDE.md, spec, and plan checkboxes updated |

### software-architect — code in specs and plans

Specs and plans describe **what** to build and **why**, not **how**. The backend-engineer reads the plan and proposes the implementation with their own expertise.

- **Default: no code.** Specs and plans use prose, tables, and file/method names. They do not include implementation code.
- **Exception: agreed solutions only.** If a specific solution was analyzed in depth with the user and explicitly agreed upon (e.g. a non-obvious algorithm, a Firestore query shape, a data migration strategy), that solution may be included in the spec to preserve the decision. Mark it clearly as an agreed solution, not a suggestion.
- **Rationale:** architect-authored code in plans has introduced bugs that reached the backend-engineer without review. The backend-engineer's implementation is the authoritative solution — the plan must not pre-empt it.

### When the backend-engineer hits an undocumented decision

If during implementation an architectural or business decision arises that isn't covered by the spec or plan, the backend-engineer **stops and asks** — either the user directly or the `software-architect` agent — before proceeding. It does not guess or invent behavior.

### Agents available

| Agent | When to invoke |
|---|---|
| `software-architect` | Write or update specs and plans; architectural decisions; design review |
| `backend-engineer` | Implement a plan step: new endpoint, middleware, service, or refactor |
| `test-engineer` | Write or fix tests for modified files |
| `docs-engineer` | Review inline docs; update CLAUDE.md; mark spec and plan progress; close plans and specs |

---

## Git Commit Convention

### Format

```
[type] short description

spec: <spec-file> §<section>
- Change description in src/path/to/file.js
- Change description in src/path/to/other.js

Used agents: agent-name, agent-name2
```

### Rules

- **One commit per spec sub-item** (e.g. `§1.1`). A single spec item may produce multiple commits of different types — typical sequence: `[feat]` → `[test]` → `[docs]`.
- **One type per commit** — never mix production code with tests or docs in the same commit.
- **Spec reference once** at the top of the body, then a list of short change descriptions pointing to the file where the change lives.
- **Always sign off**: `git commit -s` — adds `Signed-off-by:` to record who accepted the changes.
- **Used agents** — list every agent that contributed (e.g. `backend-engineer`, `test-engineer`). Omit the line if no agent was used.

### Types

| Type | When to use |
|---|---|
| `feat` | New feature for the user (not build scripts) |
| `fix` | Bug fix for the user (not build scripts) |
| `docs` | Documentation changes only |
| `style` | Formatting, missing semicolons — no logic change |
| `refactor` | Renaming, restructuring — no behavior change |
| `test` | Adding or refactoring tests — no production code change |
| `chore` | Tooling, config, dependency updates — no production code change |

### Example

```
[feat] implement JWT sign and verify

spec: 2026-06-05_01_v3 §1.1
- jwt.sign() and jwt.verify() implemented in src/utils/auth/jwt.js
- jwtSecret and jwtTtl added to src/config/index.js

Used agents: backend-engineer
```

---

## Commands

```bash
npm run dev         # Development with nodemon and DEBUG=app:* enabled
npm test            # Run Jest with coverage (sets NODE_ENV=test)
npm run test:watch
npm run indexes     # Sync Firestore composite indexes from firestore.indexes.json to the active GCP project
npm run deploy      # gcloud app deploy app.yaml
```

Run a single test file:
```bash
NODE_ENV=test npx jest src/path/to/__test__/file.test.js
```

Local dev requires GCP credentials to connect to Firestore:
```bash
gcloud auth application-default login
```

## Environment Variables

Copy `.env.example` to `.env`:

| Variable | Description |
|---|---|
| `PORT` | Default `3000` |
| `NODE_ENV` | `development` / `production` / `test` |
| `CORS` | Comma-separated origins, default `*` |
| `GOOGLE_CLIENT_ID` | Google OAuth2 |
| `GOOGLE_CLIENT_SECRET` | Google OAuth2 |
| `GOOGLE_OAUTH_REDIRECT` | OAuth2 callback URL |
| `JWT_SECRET` | Secret for signing and verifying JWTs |
| `JWT_TTL` | JWT expiry duration, default `'2h'` |

## Deployment

Google App Engine (Node.js 24). Config in `app.yaml`. Scales from 0 to 3 instances.

---

## Architecture

### Router mount order (`src/app.js`)

Four surfaces plus one middleware registered in strict order — order matters because the redirect router is a catch-all:

```
rootRouter      →  GET /           Static HTML home page + public assets
apiV1           →  /api/v1/**      CRUD REST API
healthRouter    →  GET /_ah/health App Engine health check (Firestore ping)
botReject       →  (middleware)    Rejects known bot path patterns with 404 before Firestore
redirectRoute   →  GET /*          Catch-all: URL shortener redirect
```

---

### Surface 1 — Root (`src/routes/root.js`)

Serves static files from `src/public/` and the home HTML. Sets `Cache-Control: 30min` in production.

---

### Surface 2 — REST API (`src/api/`)

```
/api/v1/auth                    →  src/api/auth/routes/auth.route.api.js
/api/v1/redirects               →  src/api/redirect/routes/redirect.route.api.js
/api/v1/users                   →  src/api/users/routes/user.route.api.js
/api/v1/users/me/api-keys       →  src/api/users/routes/api-key.route.js (sub-router)
/api/v1/groups                  →  src/api/groups/routes/group.route.api.js
```

Every endpoint is validated by `validatorHandler` (Joi) before the handler runs. Pattern:

```
Request → Joi validation → new Model(req.body) → Service.method() → JSON response
```

---

### Surface 3 — Redirect catch-all (`src/redirect/`)

Handles any `GET /*` not matched above. This is the public-facing URL shortener:

```
GET /some/path
  ↓
nodeCache.has(path)?
  ├── HIT  → url = cache.get(path)
  └── MISS → RedirectServiceApi.getByPath(path) → Firestore query where('path', '==', path)
              nodeCache.set(path, url, 5min TTL)
  ↓
Cache-Control: public, max-age=300  (production only)
res.redirect(302, url)
```

---

### `src/redirect/` imports directly from `src/api/redirect/`

`src/redirect/routes/redirect.router.js` imports the redirect service directly from `src/api/redirect/services/`. There are no re-export intermediaries. When modifying redirect logic, always edit under `src/api/redirect/`.

---

### Data layer inheritance chain

```
Firestore SDK
    ↑
FireStoreAdapter          src/lib/firestore.js
  .get / .create / .update / .delete
  • .create() auto-adds created/updated Firestore Timestamps
  • .get() / .update() throw boom.notFound if doc doesn't exist
    ↑
CrudService               src/utils/crud.service.js
  constructor(collection, docParser, createParser, updateParser)
  • Wraps FireStoreAdapter; applies parsers on every read/write
  • .find(query, options) supports orderBy (prefix "-" = desc), offset, limit
    ↑ (extends)
RedirectServiceApi        src/api/redirect/services/redirect.service.js
  • .getByPath(path)  — Firestore where('path', '==', path)
  • .create()         — enforces path uniqueness before insert
                        (throws boom.badRequest if path already taken)

UserService               src/api/users/services/user.service.js
  • .getByEmail(email) — Firestore where('email', '==', email)
  • .create()          — enforces email uniqueness before insert
  • .delete(id)        — fetch-first (findOne) to capture user.groups before deletion.
                         When membershipService is available and the user has groups: builds a
                         single WriteBatch with the user doc delete and all group arrayRemove ops
                         (via membershipService.addOpsToRemoveUserFromGroups), then commits
                         atomically. Falls back to super.delete(id) when membershipService is
                         absent or the user belongs to no groups (no group cleanup needed).
  Note: User constructor accepts email as optional (guard: email ? ... : undefined).
        PATCH handlers do not supply email — it is immutable post-creation and
        discarded by updateParser before any Firestore write.

GroupService              src/api/groups/services/group.service.js
  • .getBySlug(slug)   — Firestore where('slug', '==', slug)
                         Also called by the redirect router (POST /api/v1/redirects) to
                         verify the group exists in Firestore before constructing the path.
                         Admin users bypass this check (they can create root-level paths).
  • .create()          — enforces slug uniqueness before insert
  • .update(id, group) — fetch-first (findOne) unconditionally; throws 404 if the group does not exist,
                         regardless of whether `users` is in the payload. If `users` is present,
                         diffs old vs new membership (comparing user IDs — Firestore document IDs,
                         not email strings) and builds a WriteBatch with one update per
                         added/removed member plus the group itself; commits atomically.
                         Does NOT call super.update() — bypasses FireStoreAdapter entirely;
                         Timestamps are set manually.
  • .delete(id)        — fetch-first (findOne) to read group.users (user IDs) and group.slug; builds a
                         WriteBatch with FieldValue.arrayRemove(slug) on each member's
                         User.groups field (no fetch per user — server-side op); adds the
                         group delete to the batch; commits atomically. Timestamps set manually.
  Receives UserService via constructor injection (D12).

MembershipService         src/api/users/services/membership.service.js
  Does NOT extend CrudService. Breaks the circular dependency UserService ↔ GroupService.
  Receives userService and groupService by constructor injection.
  • .addOpsToRemoveUserFromGroups(batch, userId, userGroups) — for each slug in userGroups,
    resolves the group via GroupService.getBySlug(slug) and adds a batch.update with
    FieldValue.arrayRemove(userId) to the provided WriteBatch. Does NOT commit — caller
    is responsible for committing. No-op when userGroups is empty or absent.
  • .removeUserFromAllGroups(userId, userGroups) — creates its own WriteBatch, delegates
    to addOpsToRemoveUserFromGroups, then commits atomically. Standalone use only;
    UserService.delete() calls addOpsToRemoveUserFromGroups directly to share the batch.
    No-op when userGroups is empty or absent.
  Wired in src/api/users/routes/user.route.api.js: userServiceForGroup (bare, no membershipService)
  → GroupService → MembershipService(userServiceForGroup, groupService) → UserService(membershipService).
  userServiceForGroup must not carry a membershipService to avoid a circular dependency.

ApiKeyService             src/api/users/services/api-key.service.js
  Does NOT extend CrudService — the subcollection path includes a dynamic userId segment
  that CrudService's fixed-collection constructor cannot accommodate. Accesses Firestore
  directly via the singleton firestoreClient.
  • .list(userId)         — returns all keys in users/{userId}/apiKeys, ordered by createdAt desc
  • .create(userId, key)  — enforces 10-active-key limit; enforces keyHash uniqueness (throws 409
                            on collision — caller should retry); writes to subcollection;
                            createdAt Timestamp set manually (no FireStoreAdapter auto-timestamping)
  • .revoke(userId, keyId)— sets active=false; returns keyHash for caller to invalidate cache
  • .findByHash(keyHash)  — collectionGroup('apiKeys').where('keyHash','==',keyHash).limit(1);
                            extracts userId from docSnap.ref.parent.parent.id;
                            returns {apiKey, userId} or null
  Requires COLLECTION_GROUP index on apiKeys.keyHash (see firestore.indexes.json §3.7).

AuthTokenService          src/api/users/services/auth-token.service.js
  Does NOT extend CrudService — the subcollection path includes a dynamic userId segment.
  Accesses Firestore directly via the singleton firestoreClient.
  • .read(userId)          — reads users/{userId}/auth/google; returns null if doc does not exist
  • .write(userId, tokens) — set-with-merge on users/{userId}/auth/google; sets updatedAt Timestamp manually
```

---

### Parser pattern (injected into CrudService)

Each resource defines three parser functions:

| Parser | Direction | Responsibility |
|---|---|---|
| `docParser` | `DocumentSnapshot → Model` | Reads from Firestore; converts Timestamps to Date |
| `createParser` | `Model → plain object` | Strips `id`; sets defaults (`permission: []`, `categories: []`) |
| `updateParser` | `Model → plain object` | Strips `id`, `created`, immutable fields (`owner`/`email`/`path`); removes `undefined` keys via `cleanDocObject` |

Parsers live alongside their resource: `src/api/{resource}/parsers/`.

---

### Permission model

`Redirect.permission` is a `string[]` with entries in the format `"read:{group}"`. The list API filters with `array-contains-any` to support users in multiple groups:

```js
// When user has at least one group:
Filter.or(
  Filter.where('owner', '==', email),
  Filter.where('permission', 'array-contains-any', ['read:fc', 'read:cs', ...])
)
// When user has no groups:
Filter.where('owner', '==', email)
```

Groups are Firestore documents (collection `groups`) with a `users: string[]` array of user IDs (Firestore document IDs, not email strings).
Permission constants (`read`, `edit`, `delete`) and `OWNER_SCOPES` are in `src/models/scope.model.js`.

---

### Auth — JWT, OAuth2, and redirect routes protected

- **JWT**: `src/utils/auth/jwt.js` — `sign()` and `verify()` implemented. Config: `config.jwt.jwtSecret` / `config.jwt.jwtTtl`.
- **Google OAuth2**: strategy complete in `src/utils/auth/strategies/google-oauth2.strategy.js`. Callback looks up user by email, writes OAuth tokens to `users/{userId}/auth/google` via `AuthTokenService.write()`, calls `done(null, user)`. Returns 401 if email not in Firestore.
- **`authenticate` middleware**: `src/middleware/authenticate.middleware.js` — Bearer token dispatcher. If the token starts with `sk_1kg_`, delegates to `authenticateApiKey` (SHA-256 hash lookup via `ApiKeyService.findByHash`, with a 30s node-cache TTL). Otherwise delegates to `authenticateJwt` (JWT verify). Both paths set `req.user`. For API Key auth, `req.user` additionally contains `apiKey: { id, scopes }`. Cache TTL means a revoked key remains valid for up to 30 seconds; the `DELETE /me/api-keys/:keyId` endpoint calls `nodeCache.del(keyHash)` for best-effort same-instance invalidation.
- **`authorize` middleware**: `src/middleware/authorize.middleware.js` — factory `authorize(...roles)` that checks `req.user.role`.
- **`authorizeApiKeyScope` middleware**: `src/middleware/authorize-api-key-scope.middleware.js` — factory `authorizeApiKeyScope(requiredScope)`. No-op for JWT requests (`req.user.apiKey === undefined`). For API Key requests, returns 403 if the required scope is not in `req.user.apiKey.scopes`. Applied per-route on the redirect router.
- **Auth routes**: `src/api/auth/routes/auth.route.api.js` — mounted at `/api/v1/auth/`. Two routes: `GET /google` (initiates OAuth2 flow) and `GET /google/callback` (exchanges code, returns JWT). Auth routes are under `/api/v1/auth/` and never at root level — the catch-all `GET /*` would intercept them otherwise (D4).
- **`passport.initialize()`** mounted in `src/app.js` before `apiV1`.
- **`/api/v1/redirects` is fully protected**: `authenticate` is applied at router level (`redirectRouterApi.use(authenticate)`). All five routes require a valid JWT.
- **`GET /api/v1/redirects` admin bypass**: if `req.user.role === 'admin'`, the handler calls `redirectServicieApi.getAll(options)` and returns before building the Firestore filter. Non-admin users see only redirects they own or have `read:{group}` permission on.
- **`GET /api/v1/redirects/:id` access control**: after fetching the document, the handler checks that the requester is admin, or is the owner, or belongs to a group whose `read:{slug}` entry appears in `redirect.permission`. Returns 403 if none of the conditions are met (D3).
- **`/api/v1/users` is fully protected**: `authenticate` is applied at router level. Both the users and groups routers reject API Key requests entirely with 403 — a `router.use()` middleware checks `req.user.apiKey !== undefined` immediately after `authenticate`. `GET /`, `GET /:id`, `POST /`, and `DELETE /:id` additionally require `authorize('admin')`. `GET /me` is accessible to any authenticated (JWT) user. `PATCH /:id` is accessible to admins or to the user editing their own profile.
- **`/api/v1/users/me/api-keys`**: sub-router (`src/api/users/routes/api-key.route.js`) mounted inside the user router at `/me/api-keys`, after `GET /me` and before `GET /:id` (Express declaration order). The API key rejection middleware applies to this path as well — managing API keys requires a full JWT session; API Key bearer tokens cannot be used to create or revoke other API keys. `POST /` returns the plaintext token only once; only `keyHash` is stored. Non-admin users cannot request admin-only scopes (`read:users`, `write:users`, `read:groups`, `write:groups`).
- **`/api/v1/redirects` accepts API Keys**: `authorizeApiKeyScope` is applied per-route. `GET /` and `GET /:id` require scope `read:redirects`; `POST /`, `PATCH /:id`, and `DELETE /:id` require scope `write:redirects`. JWT requests pass through the scope middleware unconditionally.

---

### Error handling pipeline

```
any next(err) in a route handler
  ↓
wrapErrors   — non-Boom errors → boom.badImplementation() [500]
  ↓
errorHandler:
  /api/** routes → JSON { statusCode, error, message }  (+stack in dev) — always, regardless of status code
  browser 404   → serves src/views/NoFound/NotFound.html
  browser 500 (prod) → serves src/views/errorServer/serverError.html
  browser other → JSON { statusCode, error, message }  (+stack in dev)
```

---

### Caching

- **Server-side**: singleton `node-cache` instance (`src/utils/cache.js`). Two keying schemes:
  - Redirect path → destination URL. Key = path string, TTL = 5 minutes (300s). Used by the public catch-all router.
  - API Key hash → `req.user` object. Key = SHA-256 hex of the token, TTL = 30 seconds. Used by `authenticate` to avoid one Firestore read per API Key request. Entries are deleted by `apiKeyService.revoke()` callers for best-effort same-instance invalidation.
- **Client-side**: `Cache-Control: public, max-age=300` header set only in production.
- The home page sets a 30-minute client cache.

---

## Test Layout

Tests live in `__test__/` subdirectories next to the code they test:

```
src/lib/__test__/firestore.test.js
src/middleware/__test__/error.handler.test.js
src/middleware/__test__/notFound.handler.test.js
src/redirect/routes/__test__/redirect.route.test.js
```

Coverage is collected automatically on every `npm test` run (output in `coverage/`).
