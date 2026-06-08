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

Permissions live in `Redirect.permission: string[]`, entries formatted as `"read:{group}"` or `"edit:{group}"`.  
A redirect is visible to a requester if:
- The requester is the `owner`, OR
- The requester belongs to a group listed in `permission` with the `read` scope.

Only the owner (or an admin) can edit or delete a redirect.

### Branch strategy

- `main` — production. Only the public redirect catch-all is live. No API, no auth.
- `dev` — active development. API v1 (`/api/v1/redirects`, `/api/v1/users`) + auth scaffolding. Not yet merged to main.

---

## Development Flow

Every unit of work — a spec step, a bug fix, a refactor — follows this three-step cycle before moving to the next:

```
[backend-engineer] → [feat/fix/refactor] commit
        ↓
[test-engineer]    → [test] commit
        ↓
[docs-engineer]    → [docs] commit  (or confirms docs are sufficient)
```

### What counts as a unit of work

A unit is the smallest change that is complete and independently valuable:

- One sub-item of a spec (e.g. §1.1, §2.3)
- A single bug fix
- A single function refactor

Do not batch multiple spec sub-items into one cycle. Each sub-item gets its own `[feat] → [test] → [docs]` sequence.

### Agent responsibilities per step

| Step | Agent | Produces |
|---|---|---|
| Code | `backend-engineer` | Working implementation, no regressions in test suite |
| Test | `test-engineer` | Tests covering all branches and edge cases of the new code |
| Docs | `docs-engineer` | Inline JSDoc where required; CLAUDE.md, specs, and plan checkboxes updated to reflect decisions made and progress achieved |

### When the backend-engineer hits an undocumented decision

If during implementation an architectural or business decision arises that isn't covered by the spec, the backend-engineer **stops and asks** — either the user directly or the `software-architect` agent — before proceeding. It does not guess or invent behavior.

### Agents available

| Agent | When to invoke |
|---|---|
| `backend-engineer` | Implement a spec task, new endpoint, middleware, or service |
| `test-engineer` | Write or fix tests for modified files |
| `docs-engineer` | Review inline docs, update CLAUDE.md, verify specs reflect confirmed decisions, and mark plan progress |
| `software-architect` | Architectural decisions, design review, spec verification |

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

## Deployment

Google App Engine (Node.js 24). Config in `app.yaml`. Scales from 0 to 3 instances.

---

## Architecture

### Router mount order (`src/app.js`)

Three surfaces registered in strict order — order matters because the redirect router is a catch-all:

```
rootRouter      →  GET /          Static HTML home page + public assets
apiV1           →  /api/v1/**     CRUD REST API
redirectRoute   →  GET /*         Catch-all: URL shortener redirect
```

---

### Surface 1 — Root (`src/routes/root.js`)

Serves static files from `src/public/` and the home HTML. Sets `Cache-Control: 30min` in production.

---

### Surface 2 — REST API (`src/api/`)

```
/api/v1/auth        →  src/api/auth/routes/auth.route.api.js
/api/v1/redirects   →  src/api/redirect/routes/redirect.route.api.js
/api/v1/users       →  src/api/users/routes/user.route.api.js
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

### `src/redirect/` is a pure facade over `src/api/redirect/`

All files in `src/redirect/` are re-exports. The real code lives in `src/api/redirect/`:

```
src/redirect/models/redirect.model.js      → re-export → src/api/redirect/models/
src/redirect/parsers/redirect.parsers.js   → re-export → src/api/redirect/parsers/
src/redirect/services/redirect.service.js  → re-export → src/api/redirect/services/
```

When modifying redirect logic, always edit under `src/api/redirect/`.

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
RedirectServiceApi        src/api/redirect/services/redirect.service.api.js
  • .getByPath(path)  — Firestore where('path', '==', path)
  • .create()         — enforces path uniqueness before insert
                        (throws boom.badRequest if path already taken)

UserServices              src/api/users/services/user.service.api.js
  • .getByEmail(email) — Firestore where('email', '==', email)
  • .create()          — enforces email uniqueness before insert
```

---

### Parser pattern (injected into CrudService)

Each resource defines three parser functions:

| Parser | Direction | Responsibility |
|---|---|---|
| `docParser` | `DocumentSnapshot → Model` | Reads from Firestore; converts Timestamps to Date |
| `createParser` | `Model → plain object` | Strips `id`; sets defaults (`permission: []`, `categories: []`) |
| `updateParser` | `Model → plain object` | Strips `id`, `created`, immutable fields (`owner`/`email`); removes `undefined` keys via `cleanDocObject` |

Parsers live alongside their resource: `src/api/{resource}/parsers/`.

---

### Permission model

`Redirect.permission` is a `string[]` with entries in the format `"read:{group}"`. The list API filters with:

```js
Filter.or(
  Filter.where('owner', '==', owner),
  Filter.where('permission', 'array-contains', `read:${group}`)
)
```

Groups are Firestore documents (collection `groups`) with a `users: string[]` array.
Permission constants (`read`, `edit`, `delete`) and `OWNER_SCOPES` are in `src/models/scope.model.js`.

---

### Auth — routes implemented, not yet applied to protected endpoints

- **JWT**: `src/utils/auth/jwt.js` — `sign()` and `verify()` implemented. Config: `config.jwt.jwtSecret` / `config.jwt.jwtTtl`.
- **Google OAuth2**: strategy complete in `src/utils/auth/strategies/google-oauth2.strategy.js`. Callback looks up user by email, updates tokens, calls `done(null, savedUser)`. Returns 401 if email not in Firestore.
- **`authenticate` middleware**: `src/middleware/authenticate.middleware.js` — verifies Bearer JWT, sets `req.user` to decoded payload.
- **`authorize` middleware**: `src/middleware/authorize.middleware.js` — factory `authorize(...roles)` that checks `req.user.role`.
- **Auth routes**: `src/api/auth/routes/auth.route.api.js` — mounted at `/api/v1/auth/`. Two routes: `GET /google` (initiates OAuth2 flow) and `GET /google/callback` (exchanges code, returns JWT). Auth routes are under `/api/v1/auth/` and never at root level — the catch-all `GET /*` would intercept them otherwise (D4).
- **`passport.initialize()`** mounted in `src/app.js` before `apiV1`.
- **No auth middleware is applied to redirect/user routes yet.** Those APIs are currently unprotected.

---

### Error handling pipeline

```
any next(err) in a route handler
  ↓
wrapErrors   — non-Boom errors → boom.badImplementation() [500]
  ↓
errorHandler:
  404  → serves src/views/NoFound/NotFound.html
  500 (prod) → serves src/views/errorServer/serverError.html
  other → JSON { statusCode, error, message }  (+stack in dev)
```

---

### Caching

- **Server-side**: singleton `node-cache` instance (`src/utils/cache.js`), keyed by path, TTL = 5 minutes (300s).
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
