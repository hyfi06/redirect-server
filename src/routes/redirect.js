const express = require('express');
const RedirectService = require('../services/redirect');
const { setClientCache } = require('../utils/cache');
const { FIVE_MINUTES_IN_SECONDS } = require('../utils/timeConst');

const redirectService = new RedirectService();

function redirectRouter(app) {
  const router = express.Router();

  app.use('/', router);

  router.get('/*', async function (req, res, next) {
    const path = req.params[0];
    try {
      const redirectData = await redirectService.getByPath(path);
      setClientCache(res, FIVE_MINUTES_IN_SECONDS);
      res.redirect(redirectData.url);
    } catch (err) {
      next(err);
    }
  });
}

module.exports = redirectRouter;
