require('dotenv').config();

// Skipped in test: production secrets (JWT_SECRET, OAuth credentials) are not
// present in the CI/test environment. The guard ensures App Engine's health-check
// fails before the server accepts traffic when a required variable is missing.
if (process.env.NODE_ENV !== 'test') {
  const REQUIRED = ['JWT_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_OAUTH_REDIRECT'];
  const missing = REQUIRED.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error(`[config] Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
}

module.exports = {
  dev: process.env.NODE_ENV != 'production',
  // App Engine standard puts exactly one reverse proxy (the GFE) in front of the
  // instance — `1` trusts that single hop so Express resolves req.ip from
  // X-Forwarded-For/Forwarded. `true` is deliberately avoided: it trusts an
  // arbitrary proxy chain, letting a client spoof its IP. No real proxy sits in
  // front of the process outside production, so trust proxy is `false` there.
  trustProxy: process.env.NODE_ENV === 'production' ? 1 : false,
  port: process.env.PORT || 3000,
  cors: process.env.CORS && process.env.CORS !== '*' ? process.env.CORS.split(',') : true,
  version: process.env.npm_package_version,
  firestore: {
    collections: {
      redirects: 'redirects',
      users: 'users',
      groups: 'groups',
    },
  },
  oauthGoogle: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    oauthRedirect: process.env.GOOGLE_OAUTH_REDIRECT,
  },
  jwt: {
    jwtSecret: process.env.JWT_SECRET,
    jwtTtl: process.env.JWT_TTL || '2h',
  },
  rateLimit: {
    windowMs: 60000,
    limit: 60,
  },
};
