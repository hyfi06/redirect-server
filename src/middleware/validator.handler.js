const Joi = require('joi');
const boom = require('@hapi/boom');

/**
 * Validate data form given property and schema
 * @param {Joi.ObjectSchema} schema
 * @param {string} property
 * @returns {import('express').RequestHandler}
 */
function validatorHandler(schema, property) {
  return async (req, res, next) => {
    const data = req[property];
    const { error } = schema.validate(data, { abortEarly: false });
    if (error) {
      return next(boom.badRequest(error));
    }
    next();
  };
}

module.exports = validatorHandler;
