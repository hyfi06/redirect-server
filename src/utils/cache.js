const config = require('../config');

function setClientCache(res, seconds) {
  if (!config.dev) {
    res.set('Cache-Control', `public, max-age=${seconds}`);
  }
}



module.exports = { setClientCache };
