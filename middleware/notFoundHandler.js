const boom = require('@hapi/boom');

/**
 * Generate a response 404
 * @param {*} req request
 * @param {*} res response
 */
function notFoundHandler(req, res) {
  const {
    output: { statusCode, payload },
  } = boom.notFound();

  res.status(statusCode).json(payload);
}

module.exports = notFoundHandler;
