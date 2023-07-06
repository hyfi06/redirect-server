const express = require('express');

function apiV1(app) {
  const router = new express.Router();
  app.use('/api/v1', router);
  //router.use('/redirect',redirectRouter)
}

module.exports = {
  apiV1,
};
