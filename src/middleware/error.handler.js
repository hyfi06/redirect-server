const boom = require('@hapi/boom');
const config = require('../config');
const path = require('path');

/**
 * Appends stack trace to error payload in dev; returns payload unchanged otherwise.
 * @param {object} err - Boom payload object
 * @param {string} stack - Error stack string
 * @returns {object}
 */
function withErrorStack(err, stack) {
  if (config.dev) {
    return { ...err, stack };
  }
  return err;
}

/**
 * Normalizes non-Boom errors to boom.badImplementation (500) before passing to errorHandler.
 * Returns after calling next() so the fallthrough next(err) is never reached for non-Boom errors.
 * @param {Error} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
function wrapErrors(err, req, res, next) {
  if (!err.isBoom) {
    return next(boom.badImplementation(err));
  }
  next(err);
}

/**
 * @param {import('@hapi/boom').Boom} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const {
    output: { statusCode, payload },
  } = err;
  if (statusCode == 404) {
    res.sendFile(path.join(__dirname, '../views/NoFound/NotFound.html'));
  } else if (statusCode == 500 && !config.dev) {
    res.sendFile(path.join(__dirname, '../views/errorServer/serverError.html'));
  } else {
    res.status(statusCode).json(withErrorStack(payload, err.stack));
  }
}

module.exports = {
  wrapErrors,
  errorHandler,
};
