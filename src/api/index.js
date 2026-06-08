const express = require('express');

const { authRouterApi } = require('./auth/routes/auth.route.api');
const { redirectRouterApi } = require('./redirect/routes/redirect.route.api');
const { userRouterApi } = require('./users/routes/user.route.api');
const { groupRouterApi } = require('./groups/routes/group.route.api');

function apiV1(app) {
  const router = express.Router();
  app.use('/api/v1', router);
  router.use('/auth', authRouterApi);
  router.use('/redirects', redirectRouterApi);
  router.use('/users', userRouterApi);
  router.use('/groups', groupRouterApi);
}

module.exports = {
  apiV1,
};
