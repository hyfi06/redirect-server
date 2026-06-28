const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../../config');
const { nodeCache, setClientCache } = require('../../utils/cache');
const { FIVE_MINUTES_IN_SECONDS } = require('../../utils/timeConst');
const { redirectService } = require('../../lib/services');
const clickCounter = require('../../utils/click-counter');

const redirectRouter = express.Router({
  caseSensitive: true,
});

const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.limit,
  // RateLimit-* headers suppressed — browsers following redirects cannot act on quota info.
  standardHeaders: false,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  handler: (req, res) => {
    res.status(429).json({ statusCode: 429, error: 'Too Many Requests', message: 'rate limit exceeded' });
  },
});

redirectRouter.use(limiter);

// NOTE: Joi validation is not applied here. The slugPath pattern rejects leading slashes,
// but Express req.path always starts with "/". Wire-in requires either adapting the
// pattern or stripping the slash before validation.
redirectRouter.get('/*', async function (req, res, next) {
  const path = req.path.replace(/\/$/,'');
  let id, url;
  try {
    if (nodeCache.has(path)) {
      ({ id, url } = nodeCache.get(path));
    } else {
      const redirectData = await redirectService.getByPath(path);
      id = redirectData.id;
      url = redirectData.url;
      nodeCache.set(path, { id, url }, FIVE_MINUTES_IN_SECONDS);
    }
    clickCounter.increment(id);
    setClientCache(res, FIVE_MINUTES_IN_SECONDS);
    res.redirect(url);
  } catch (err) {
    next(err);
  }
});

module.exports = redirectRouter;
