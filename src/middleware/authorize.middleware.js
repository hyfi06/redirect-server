const boom = require('@hapi/boom');

/**
 * Returns middleware that allows the request only if req.user.role is in the given roles list.
 * Requires authenticate to have run first.
 *
 * @param {...string} roles
 * @returns {Function} Express middleware
 */
function authorize(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return next(boom.forbidden('Insufficient permissions'));
    }
    next();
  };
}

module.exports = { authorize };
