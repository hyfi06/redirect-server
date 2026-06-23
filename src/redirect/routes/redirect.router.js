const express = require('express');
const RedirectService = require('../../api/redirect/services/redirect.service');
const { nodeCache, setClientCache } = require('../../utils/cache');
const { FIVE_MINUTES_IN_SECONDS } = require('../../utils/timeConst');

const redirectService = new RedirectService();

const redirectRouter = express.Router({ 
  caseSensitive: true,
});

// NOTE: Joi validation is not applied here. The slugPath pattern rejects leading slashes,
// but Express req.path always starts with "/". Wire-in requires either adapting the
// pattern or stripping the slash before validation.
redirectRouter.get('/*', async function (req, res, next) {
  const path = req.path.replace(/\/$/,'');
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

module.exports = redirectRouter;
