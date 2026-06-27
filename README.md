# 1kg.me — URL Shortener

Self-hosted URL shortener running on Google Cloud App Engine + Firestore. Users register redirect paths (`1kg.me/{group-slug}/{path}` → URL). Access is controlled by ownership and group-based permissions.

**Stack:** Node.js 24, Express 4, Firestore, Google OAuth2 + JWT.

---

## Changelog v4.1.1

- Soft-delete for users and groups (`deletedAt` field); soft-deleted users cannot log in
- API Key authentication (`sk_1kg_` prefix, scoped, SHA-256 hash stored in Firestore)
- Permission scopes on redirects: `read:{group}`, `edit:{group}`, `delete:{group}`
- `GET /api/v1/users?inactive=true` and `GET /api/v1/groups?inactive=true` (admin only)
- `GET /api/v1/users/me/api-keys` sub-resource for managing API keys
- Redirect `owner` field changed from email string to Firestore document ID (userId)
- Eliminated dead code: auth token subcollection removed; shared utilities extracted

## Changelog v3

- JWT authentication (HS256, configurable TTL)
- Google OAuth2 login flow
- REST API v1: redirects, users, groups
- Path namespace enforcement (group-scoped paths for regular users)
- Structured JSON logging for Cloud Logging
- `GET /_ah/health` health check endpoint with Firestore connectivity probe

---

## Prerequisites

- Node.js >= 24
- [Google Cloud CLI](https://cloud.google.com/sdk/docs/install-sdk)
- GCP project with App Engine and Firestore (Native mode) enabled

---

## Local Setup

```bash
npm install
cp .env.example .env
# Edit .env with your values
gcloud auth application-default login
npm run dev
```

---

## Environment Variables

| Variable | Description | Required | Default |
|---|---|---|---|
| `PORT` | Server port | No | `3000` |
| `NODE_ENV` | Environment (`development`/`production`/`test`) | No | — |
| `CORS` | Comma-separated allowed origins | **Yes (production)** | `*` |
| `JWT_SECRET` | Secret for signing and verifying JWTs (min 32 chars recommended) | **Yes** | — |
| `JWT_TTL` | JWT expiry duration (e.g. `2h`, `1d`, `30m`) | No | `2h` |
| `GOOGLE_CLIENT_ID` | Client ID from Google Cloud Console | **Yes** | — |
| `GOOGLE_CLIENT_SECRET` | Client Secret from Google Cloud Console | **Yes** | — |
| `GOOGLE_OAUTH_REDIRECT` | OAuth2 callback URL (e.g. `https://1kg.me/api/v1/auth/google/callback`) | **Yes** | — |

> `JWT_SECRET` and `GOOGLE_CLIENT_SECRET` must never be written into `app.yaml`. Use Secret Manager or environment injection at deploy time.

> **Production:** `CORS` defaults to `*` (any origin). Always set it explicitly to the allowed origin(s) (e.g. `https://1kg.me`) in your production environment or deploy pipeline. Leaving it as `*` allows any browser origin to make credentialed API requests.

---

## Tests

```bash
npm test
```

---

## Deploy

> **Order matters:** Firestore indexes must be deployed and reach **READY** status before the application is deployed. Deploying the app first will cause 500 errors on the first requests that hit composite-index queries (non-admin users listing redirects or groups).

### Step 1 — Deploy Firestore indexes

```bash
npm run indexes
```

This syncs `firestore.indexes.json` to the active GCP project. Wait until all indexes show `READY` in the [Firestore console](https://console.cloud.google.com/firestore/indexes) before proceeding.

Alternatively, create them manually:

```bash
gcloud firestore indexes composite create \
  --collection-group=redirects \
  --field-config=field-path=owner,order=ASCENDING \
  --field-config=field-path=updated,order=DESCENDING

gcloud firestore indexes composite create \
  --collection-group=redirects \
  --field-config=field-path=permission,array-config=CONTAINS \
  --field-config=field-path=updated,order=DESCENDING

gcloud firestore indexes composite create \
  --collection-group=groups \
  --field-config=field-path=slug,order=ASCENDING \
  --field-config=field-path=updated,order=DESCENDING

gcloud firestore indexes composite create \
  --collection-group=users \
  --field-config=field-path=deletedAt,order=ASCENDING \
  --field-config=field-path=updated,order=DESCENDING

gcloud firestore indexes composite create \
  --collection-group=groups \
  --field-config=field-path=deletedAt,order=ASCENDING \
  --field-config=field-path=updated,order=DESCENDING
```

### Step 2 — Deploy the application

```bash
gcloud app deploy app.yaml
```

---

## API Reference

See [docs/api/v1.md](docs/api/v1.md) for full endpoint documentation.
