const Joi = require('joi');

const id = Joi.string();
// D11: path is the sub-path segment(s) WITHOUT a leading slash or group prefix.
// The handler prepends the group slug to build the fullPath stored in Firestore.
// Explicit 400 on leading slash is intentional — silent normalization would mask
// client inconsistencies (software-architect recommendation).
const slugPath = Joi.string().pattern(/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/);
const url = Joi.string().uri();
const permission = Joi.array().items(Joi.string());
const categories = Joi.array().items(Joi.string());
// group uses the same slug character set so validation is shared
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

// NOTE: getByPathRedirectSchema is not used by any route. The slugPath pattern
// rejects leading slashes, but Express req.path always starts with "/".
// Wire-in requires either adapting the pattern or stripping the slash before validation.
const getByPathRedirectSchema = Joi.object({
  path: slugPath.required(),
});

// owner is absent — it is derived from req.user in the handler, never trusted from the body
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
