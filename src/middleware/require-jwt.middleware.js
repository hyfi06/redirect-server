const boom = require('@hapi/boom');

/**
 * Rejects requests authenticated with an API Key.
 * Routes that mount this middleware require a full JWT session.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requireJwt(req, res, next) {
  if (req.user.apiKey !== undefined) return next(boom.forbidden('API Keys cannot be used on this resource'));
  next();
}

module.exports = { requireJwt };
