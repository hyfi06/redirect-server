const boom = require('@hapi/boom');

/**
 * Factory that returns middleware enforcing a required scope on API Key requests.
 * JWT requests (req.user.apiKey === undefined) pass through unconditionally.
 *
 * @param {string} requiredScope
 * @returns {import('express').RequestHandler}
 */
function authorizeApiKeyScope(requiredScope) {
  return (req, res, next) => {
    if (req.user.apiKey === undefined) return next();
    if (req.user.apiKey.scopes.includes(requiredScope)) return next();
    return next(boom.forbidden('API Key scope required: ' + requiredScope));
  };
}

module.exports = { authorizeApiKeyScope };
