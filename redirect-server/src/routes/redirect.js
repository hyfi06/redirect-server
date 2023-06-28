const express = require('express');
const RedirectService = require('../services/redirect');
const cacheResponse = require('../../utils/cacheResponse');

const redirectService = new RedirectService();

function redirectRouter(app) {
  const router = express.Router();

  app.use('/', router);

  router.get('/:urn', async function (req, res, next) {
    const urn = req.params.urn;
    try {
      const redirectData = await redirectService.getByUrn(urn);
      cacheResponse(res, 5 * 60);
      res.redirect(redirectData.url);
    } catch (err) {
      next(err);
    }
  });
}

module.exports = redirectRouter;
