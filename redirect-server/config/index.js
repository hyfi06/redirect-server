require('dotenv').config();

module.exports = {
  dev: process.env.NODE_ENV != 'production',
  port: process.env.PORT || 3000,
  cors: process.env.CORS,
  version: process.env.npm_package_version,
  firestore: {
    projectId: process.env.GOOGLE_PROJECT_ID,
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY,
    },
    collections: {
      urn: 'urn',
      users: 'users',
      groups: 'groups'
    },
  },
};
