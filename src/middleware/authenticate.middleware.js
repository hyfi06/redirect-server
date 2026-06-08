const boom = require('@hapi/boom');
const { verify } = require('../utils/auth/jwt');

/**
 * Verifies the Bearer JWT in the Authorization header and sets req.user to the decoded payload.
 * Must be applied before any middleware that reads req.user (e.g. authorize).
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next(boom.unauthorized('Missing token'));
  }
  try {
    req.user = verify(authHeader.slice(7));
    next();
  } catch {
    next(boom.unauthorized('Invalid token'));
  }
}

module.exports = { authenticate };
