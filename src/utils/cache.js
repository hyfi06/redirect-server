const config = require('../config');
const NodeCache = require('node-cache');

/**
 * Sets Cache-Control header to public with the given max-age; no-op in development.
 * @param {import('express').Response} res
 * @param {number} ttl - max-age in seconds
 */
function setClientCache(res, ttl) {
  if (!config.dev) {
    res.set('Cache-Control', `public, max-age=${ttl}`);
  }
}

/** @type {NodeCache} */
const nodeCache = new NodeCache();

module.exports = {
  setClientCache,
  nodeCache,
};
