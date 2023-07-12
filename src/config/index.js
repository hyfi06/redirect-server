require('dotenv').config();

module.exports = {
  dev: process.env.NODE_ENV != 'production',
  port: process.env.PORT || 3000,
  cors: process.env.CORS || '*',
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
};
