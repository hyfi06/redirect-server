const config = require('../config');
const NodeCache = require('node-cache');

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
