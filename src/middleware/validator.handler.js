const Joi = require('joi');
const boom = require('@hapi/boom');

/**
 * Validate data form given property and schema
 * @param {Joi.ObjectSchema} schema
 * @param {string} property
 * @returns
 */
function validatorHandler(schema, property) {
  return async (req, res, next) => {
    const data = req[property];
    const { error } = schema.validate(data, { abortEarly: false });
    if (error) {
      next(boom.badRequest(error));
    }
    next();
  };
}

module.exports = validatorHandler;
