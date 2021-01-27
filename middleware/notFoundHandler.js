const boom = require('@hapi/boom');

/**
 * Generate a response 404
 * @param {*} req request
 * @param {*} res response
 * @param {*} next response
 */
// eslint-disable-next-line no-unused-vars
function notFoundHandler(req, res, next) {
  next(boom.notFound('Route not found'));
}

module.exports = notFoundHandler;
