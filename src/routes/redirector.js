const express = require('express');
const RedirectorService = require('../../services/redirector');
const cacheResponse = require('../../utils/cacheResponse');

const redirectorService = new RedirectorService();

function redirectorApi(app) {
  const router = express.Router();
  app.use('/', router);
  router.get('/:urn', async function (req, res, next) {
    const urn = req.params.urn;
    try {
      const url = await redirectorService.getUrl(urn);
      cacheResponse(res, 5 * 60);
      res.redirect(url);
    } catch (err) {
      next(err);
    }
  });
}

module.exports = redirectorApi;
