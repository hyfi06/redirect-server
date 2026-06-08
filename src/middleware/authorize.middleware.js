const boom = require('@hapi/boom');

function authorize(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return next(boom.forbidden('Insufficient permissions'));
    }
    next();
  };
}

module.exports = { authorize };
