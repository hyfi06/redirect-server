require('dotenv').config();

module.exports = {
  dev: process.env.NODE_ENV != 'production',
  port: process.env.PORT || 3000,
  cors: process.env.CORS,
  version: process.env.npm_package_version,
  firestore: {
    collections: {
      redirects: 'redirects',
      users: 'users',
      groups: 'groups'
    },
  },
};
