const Joi = require('joi');

const id = Joi.string();
const path = Joi.string().uri({
  allowRelative: true,
  relativeOnly: true,
});
const url = Joi.string().uri();
const owner = Joi.string().email();
const scopes = Joi.array().items(Joi.string());
const categories = Joi.array().items(Joi.string());
const created = Joi.date();
const updated = Joi.date();

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
  scopes: scopes,
  categories: categories,
});

const updateRedirectSchema = Joi.object({
  path: path,
  url: url,
  owner: owner,
  scopes: scopes,
  categories: categories,
});

const deleteRedirectSchema = Joi.object({
  id: id.required(),
});

module.exports = {
  getRedirectSchema,
  getByPathRedirectSchema,
  createRedirectSchema,
  updateRedirectSchema,
  deleteRedirectSchema,
};
