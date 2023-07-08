const Joi = require("joi");
const boom = require("@hapi/boom");

/**
 * 
 * @param {Joi.object} schema 
 * @param {string} prop 
 * @returns 
 */
function validatorHandler(schema, property) {
    return async (req, res, next) => {
        const data = req[property];
        const { error } = schema.validate(data, { abortEarly: false });
        if (error) {
            next(boom.badRequest(error))
        }
        next();
    }
}

module.exports = validatorHandler;