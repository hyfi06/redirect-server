const express = require('express');

function redirectorApi(app) {
  const router = express.Router();
  app.use('/', router);
  router.get('/:urn', function (req, res, next) {
    const urn = req.params.urn;
    console.log(urn);
    res.redirect('https://www.google.com.mx');
  });
}

module.exports = redirectorApi;
