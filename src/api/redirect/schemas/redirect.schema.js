const Joi = require('joi');

const id = Joi.string();
const path = Joi.string().uri({
  allowRelative: true,
  relativeOnly: true,
});
const url = Joi.string().uri();
const owner = Joi.string().email();
const permission = Joi.array().items(Joi.string());
const categories = Joi.array().items(Joi.string());
const date = Joi.date();
const group = Joi.string();
const orderBy = Joi.string();
const offset = Joi.number().integer().min(1);
const limit = Joi.number().integer().min(1);

const getRedirectQuerySchema = Joi.object({
  owner: owner.required(),
  group: group.required(),
  orderBy: orderBy,
  offset: offset,
  limit: limit,
});

const getRedirectSchema = Joi.object({
  id: id.required(),
});

const getByPathRedirectSchema = Joi.object({
  path: path.required(),
});

const createRedirectSchema = Joi.object({
  path: path.required(),
  url: url.required(),
  owner: owner.required(),
  permission: permission,
  categories: categories,
});

const updateRedirectSchema = Joi.object({
  path: path,
  url: url,
  owner: owner,
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
