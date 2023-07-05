const express = require('express');
const { setClientCache } = require('../utils/cache');
const { HALF_AN_HOUR_IN_SECONDS } = require('../utils/timeConst');
const path = require('path');

function rootRouter(app) {
  app.use(express.static(path.join(__dirname, '../public')));

  app.get('/', (req, res) => {
    setClientCache(res, HALF_AN_HOUR_IN_SECONDS);
    res.sendFile(path.join(__dirname, '../views/home/index.html'));
  });
}

module.exports = rootRouter;
