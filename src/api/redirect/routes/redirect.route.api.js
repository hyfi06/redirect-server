const express = require('express');

const redirectRouterApi = express.Router();

redirectRouterApi.get('/', async (req, res, next) => {
  try {
  } catch (error) {
    next(error);
  }
});

module.exports = { redirectRouterApi };
