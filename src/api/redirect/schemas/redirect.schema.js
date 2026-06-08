const Joi = require('joi');

const id = Joi.string();
const slugPath = Joi.string().pattern(/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/);
const url = Joi.string().uri();
const permission = Joi.array().items(Joi.string());
const categories = Joi.array().items(Joi.string());
const group = Joi.string().lowercase().pattern(/^[a-z0-9-]+$/);
const orderBy = Joi.string();
const offset = Joi.number().integer().min(1);
const limit = Joi.number().integer().min(1);

const getRedirectQuerySchema = Joi.object({
  orderBy: orderBy,
  offset: offset,
  limit: limit,
});

const getRedirectSchema = Joi.object({
  id: id.required(),
});

const getByPathRedirectSchema = Joi.object({
  path: slugPath.required(),
});

const createRedirectSchema = Joi.object({
  path: slugPath.required(),
  url: url.required(),
  group: group,
  permission: permission,
  categories: categories,
});

const updateRedirectSchema = Joi.object({
  path: slugPath,
  url: url,
  permission: permission,
  categories: categories,
});

const deleteRedirectSchema = Joi.object({
  id: id.required(),
});

module.exports = {
  getRedirectQuerySchema,
  getRedirectSchema,
  getByPathRedirectSchema,
  createRedirectSchema,
  updateRedirectSchema,
  deleteRedirectSchema,
};
