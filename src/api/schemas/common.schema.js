const Joi = require('joi');

const id = Joi.string();
const offset = Joi.number().integer().min(1);
const limit = Joi.number().integer().min(1);
const orderBy = Joi.string();
const inactive = Joi.boolean();

module.exports = { id, offset, limit, orderBy, inactive };
