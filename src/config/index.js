require('dotenv').config();

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
  }
};
