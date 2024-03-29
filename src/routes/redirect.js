const express = require('express');
const RedirectService = require('../services/redirect');
const { nodeCache, setClientCache } = require('../utils/cache');
const { FIVE_MINUTES_IN_SECONDS } = require('../utils/timeConst');

const redirectService = new RedirectService();

function redirectRouter(app) {
  const router = express.Router();

  app.use('/', router);

  router.get('/*', async function (req, res, next) {
    const path = req.params[0];
    let url;

    try {
      if (nodeCache.has(path)) {
        url = nodeCache.get(path);
      } else {
        const redirectData = await redirectService.getByPath(path);
        url = redirectData.url;
        nodeCache.set(path, url, FIVE_MINUTES_IN_SECONDS);
      }
      setClientCache(res, FIVE_MINUTES_IN_SECONDS);
      res.redirect(url);
    } catch (err) {
      next(err);
    }
  });
}

module.exports = redirectRouter;
