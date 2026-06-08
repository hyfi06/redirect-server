const boom = require('@hapi/boom');
const { verify } = require('../utils/auth/jwt');

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
