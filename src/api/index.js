const express = require('express');

const { redirectRouterApi } = require('./redirect/routes/redirect.route.api');
const { userRouterApi } = require('./users/routes/user.route.api');

function apiV1(app) {
  const router = express.Router();
  app.use('/api/v1', router);
  router.use('/redirects', redirectRouterApi);
  router.use('/users', userRouterApi);
}

module.exports = {
  apiV1,
};
