const boom = require('@hapi/boom');

/**
 * Generate a response 404
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
// eslint-disable-next-line no-unused-vars
function notFoundHandler(req, res, next) {
  next(boom.notFound('Route not found'));
}

module.exports = notFoundHandler;
