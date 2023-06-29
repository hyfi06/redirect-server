const express = require('express');
const RedirectService = require('../services/redirect');
const cacheResponse = require('../utils/cacheResponse');

const redirectService = new RedirectService();

function redirectRouter(app) {
  const router = express.Router();

  app.use('/', router);

  router.get('/*', async function (req, res, next) {
    const path = req.params[0];
    try {
      const redirectData = await redirectService.getByPath(path);
      cacheResponse(res, 5 * 60);
      res.redirect(redirectData.url);
    } catch (err) {
      next(err);
    }
  });
}

module.exports = redirectRouter;
