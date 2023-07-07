const express = require('express');

const { redirectRouterApi } = require('./redirect/routes/redirect.route.api');

function apiV1(app) {
  const router = new express.Router();
  app.use('/api/v1', router);
  router.use('/redirect', redirectRouterApi);
}

module.exports = {
  apiV1,
};
