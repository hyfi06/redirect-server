# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [4.1.2] - 2026-06-27

### Added

- `CHANGELOG.md` — full version history following Keep a Changelog conventions.
- Migration runbook `docs/runbooks/migrate-to-v4.1.1.md` — step-by-step guide for upgrading Firestore data from pre-v4.1 to v4.1.1.

### Changed

- `README.md` — inline changelogs removed; replaced with a link to `CHANGELOG.md`.
- `docs/api/v1.md` — `owner` field in redirect response examples corrected to userId (was email); `deletedAt: null` added to all user response examples; PATCH/DELETE access descriptions updated to include group `edit`/`delete` scopes.
- Deploy script corrected: `gcloud app deploy` → `gcloud app deploy app.yaml`.
- `.gcloudignore` expanded: `e2e/`, `scripts/`, `firestore.indexes.json`, `CHANGELOG.md`, `LICENSE`, `.nvmrc`, `.env`/`.env.*` excluded from uploads; `.eslintrc` entry corrected to `.eslintrc.json`.

## [4.1.1] - 2026-06-27

### Added

- End-to-end test suite covering redirects, users, groups, and API keys.
- `npm run test:e2e` and `npm run test:e2e:cleanup` commands.

### Changed

- `requireJwt` middleware extracted from inline anonymous functions in users and groups routers into `src/middleware/require-jwt.middleware.js`.
- `findInactive()` moved from individual service classes into `CrudService` base class — inherited by `UserService` and `GroupService`.
- `toPublic(user)` helper extracted to `src/api/users/utils/user-public.js` — shared between auth callback and `GET /me`.
- `canAccess(user, resource, scope)` helper extracted within the redirect route handler.
- `parseTimestamp` / `parseOptionalTimestamp` utilities extracted to `src/utils/clean.data.utils.js` — imported by all three docParsers.
- Shared Joi fields (`id`, `offset`, `limit`, `orderBy`, `inactive`) extracted to `src/api/schemas/common.schema.js` — resource schemas import from this module.
- Deploy script corrected to `gcloud app deploy app.yaml`; `.gcloudignore` expanded.

### Removed

- `AuthTokenService` — dead code; Google OAuth tokens are never read back after issuance.

## [4.0.4] - 2026-06-23

### Fixed

- `firstName` and `lastName` no longer overwritten on `PATCH /api/v1/users/:id` when the fields are absent from the request body — removed non-`undefined` defaults from `User` model constructor.

## [4.0.3] - 2026-06-23

### Fixed

- `User.groups` defaults to `undefined` in the constructor; `createUserParser` sets `[]` — prevents `PATCH /api/v1/users/:id` from overwriting existing groups when `groups` is absent from the request body.

## [4.0.2] - 2026-06-23

### Fixed

- `errorHandler` now returns JSON for all `/api/**` routes regardless of status code. Previously, API 404 responses were returning the HTML not-found page.

## [4.0.1] - 2026-06-23

### Fixed

- Missing `COLLECTION_GROUP` index on `apiKeys.keyHash` deployed to Firestore.
- `manage-indexes.js` script corrected.

## [4.0.0] - 2026-06-22

### Added

- API Key authentication: tokens prefixed `sk_1kg_`, SHA-256 hash stored in Firestore, 30-second `node-cache` TTL.
- `POST /api/v1/users/me/api-keys`, `GET /api/v1/users/me/api-keys`, `DELETE /api/v1/users/me/api-keys/:keyId` — API key management sub-resource. Plaintext token returned only on creation.
- `ApiKeyService` (`src/api/users/services/api-key.service.js`) — operates on the `users/{userId}/apiKeys` subcollection; enforces a 10-active-key limit.
- `authorizeApiKeyScope` middleware — per-route scope enforcement on redirect endpoints (`read:redirects` / `write:redirects`). No-op for JWT requests.
- `edit:{group}` and `delete:{group}` permission scopes checked on `PATCH /:id` and `DELETE /:id` redirect handlers.
- Group existence check on `POST /api/v1/redirects` — validates the group slug via `GroupService.getBySlug()` before constructing the path (admin bypass applies).
- `MembershipService` — breaks the `UserService ↔ GroupService` circular dependency; provides atomic group ↔ user sync via `WriteBatch`.
- `UserService.delete()` — soft-delete with atomic `WriteBatch`: sets `deletedAt` on the user document and removes the user ID from all member group documents.
- `GroupService.delete()` — soft-delete with atomic `WriteBatch`: sets `deletedAt` on the group document and removes the group slug from all member user documents.
- `manage-indexes.js` script and `npm run indexes` command for syncing Firestore composite indexes from `firestore.indexes.json`.
- `.max(10)` guard on `User.groups` — maximum 10 groups per user.
- Non-admin users cannot request admin-only API key scopes (`read:users`, `write:users`, `read:groups`, `write:groups`).

### Changed

- `Group.users` now stores Firestore document IDs (user IDs) instead of email strings.
- `GroupService.update()` uses `WriteBatch` for atomic membership sync — was sequential writes. Performs unconditional fetch-first before any write.
- `UserService.update()` uses `WriteBatch` when `groups` is in the payload, delegating membership diff to `MembershipService.addOpsToSyncUserGroups()`.
- Firestore client extracted to singleton module `src/lib/firestore-client.js`.
- `authenticate` middleware extended to dispatch between JWT and API Key tokens based on the `sk_1kg_` prefix.
- Redirect `path` field made immutable — removed from `updateRedirectSchema` and `updateRedirectParser`.
- Service files renamed: dropped `.api.` infix from filenames; `UserServices` renamed to `UserService`.
- `passport` upgraded from 0.6 to 0.7.

### Fixed

- `CrudService.getAll()` and `find()` — added default `options = {}` guard to prevent crashes on missing argument.
- `authorize('admin')` placed before `validatorHandler` in `PATCH` and `DELETE` groups routes.
- `role` restricted to `valid('user', 'admin')` in `createUserSchema`.
- `UserService.create()` — non-404 guard added to avoid swallowing real Firestore errors during email uniqueness check.
- `GroupService.update()` — `findOne` guard added to throw 404 before any write attempt.
- `offset` minimum corrected from 0 to 1 in group pagination schema.
- `errorHandler` now sets the correct HTTP status code before calling `sendFile`.
- Security patches: CVE fixes in `@grpc/grpc-js` and `form-data`.

## [3.0.1] - 2026-06-10

### Fixed

- `email` made optional in `User` constructor — prevents crash when `PATCH /api/v1/users/:id` body omits `email` (email is immutable post-creation and is stripped by `updateParser` before any Firestore write).

## [3.0.0] - 2026-06-09

### Added

- JWT authentication (HS256, TTL configurable via `JWT_TTL` env var, default `2h`).
- Google OAuth2 login flow: `GET /api/v1/auth/google` and `GET /api/v1/auth/google/callback`. Returns `{ token, user }` on success; 401 if the email is not found in Firestore or the user is soft-deleted.
- `authenticate` middleware — Bearer token verification; sets `req.user`.
- `authorize` middleware — role-based access control factory (`authorize(...roles)`).
- REST API v1: `/api/v1/redirects`, `/api/v1/users`, `/api/v1/groups` — full CRUD with Joi validation on every endpoint.
- Path namespace enforcement: regular users must create paths under `/{group-slug}/{path}`; admins can use any path.
- Permission model: `read:{group}` entries on `Redirect.permission`; ownership and group-read check on `GET /api/v1/redirects/:id`.
- Admin bypass on `GET /api/v1/redirects` — returns all redirects without ownership filter.
- `splitUpdateUserSchema` — separate Joi schemas for admin edits vs. self-edit on `PATCH /api/v1/users/:id`.
- Groups resource — model, schema, parsers, service, and routes.
- Structured JSON logging compatible with Google Cloud Logging.
- `GET /_ah/health` health-check endpoint with Firestore connectivity probe.
- Bot-reject middleware — rejects known scanner path patterns with 404 before hitting Firestore.

### Fixed

- `validatorHandler` bug fix — incorrect error propagation.
- `CORS` wildcard handling corrected.
- `cleanDocObject` empty-object handling corrected.
- `updateUserParser` — prevented accidental overwrite of auth fields.
- `FireStoreAdapter.delete()` — verifies document existence before attempting delete.
- `UserService.getByEmail()` — returned raw document instead of parsed `User`; now returns parsed model.
- `User` model — `toJSON()` no longer exposes OAuth tokens.
- `jwt.sign()` / `jwt.verify()` — HS256 algorithm specified explicitly.
- Permission format validation added to redirect request schemas.
- `wrapErrors` middleware — double `next()` call on non-Boom errors corrected.

---

[Unreleased]: https://github.com/hyfi06/redirect-server/compare/v4.1.2...HEAD
[4.1.2]: https://github.com/hyfi06/redirect-server/compare/v4.1.1...v4.1.2
[4.1.1]: https://github.com/hyfi06/redirect-server/compare/v4.0.4...v4.1.1
[4.0.4]: https://github.com/hyfi06/redirect-server/compare/v4.0.3...v4.0.4
[4.0.3]: https://github.com/hyfi06/redirect-server/compare/v4.0.2...v4.0.3
[4.0.2]: https://github.com/hyfi06/redirect-server/compare/v4.0.1...v4.0.2
[4.0.1]: https://github.com/hyfi06/redirect-server/compare/v4.0.0...v4.0.1
[4.0.0]: https://github.com/hyfi06/redirect-server/compare/v3.0.1...v4.0.0
[3.0.1]: https://github.com/hyfi06/redirect-server/compare/v3.0.0...v3.0.1
[3.0.0]: https://github.com/hyfi06/redirect-server/releases/tag/v3.0.0
