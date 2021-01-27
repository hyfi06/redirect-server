const boom = require('@hapi/boom');
const config = require('../config');

/**
 * and a stack of error in develop environment
 * @param {*} err error info
 * @param {*} stack stack of error
 * @return {*} error with stack
 */
function withErrorStack(err, stack) {
  if (config.dev) {
    return { ...err, stack };
  }
  return err;
}

function wrapErrors(err, req, res, next) {
  if (!err.isBoom) {
    next(boom.badImplementation(err));
  }
  next(err);
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const {
    output: { statusCode, payload },
  } = err;
  res.status(statusCode).json(withErrorStack(payload, err.stack));
}

module.exports = {
  wrapErrors,
  errorHandler,
};
