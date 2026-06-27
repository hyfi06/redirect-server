const Joi = require('joi');
const common = require('../../schemas/common.schema');

// D11: path is the sub-path segment(s) WITHOUT a leading slash or group prefix.
// The handler prepends the group slug to build the fullPath stored in Firestore.
// Explicit 400 on leading slash is intentional — silent normalization would mask
// client inconsistencies (software-architect recommendation).
const slugPath = Joi.string().pattern(/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/);
const url = Joi.string().uri();
// Format is enforced here so malformed entries never reach Firestore — queries
// rely on exact string matching (array-contains-any) against 'read:{slug}' entries.
const permission = Joi.array().items(
  Joi.string().pattern(/^(read|edit|delete):[a-z0-9-]+$/)
);
const categories = Joi.array().items(Joi.string());
// group uses the same slug character set so validation is shared
const group = Joi.string().lowercase().pattern(/^[a-z0-9-]+$/);

const getRedirectQuerySchema = Joi.object({
  orderBy: common.orderBy,
  offset: common.offset,
  limit: common.limit,
});

const getRedirectSchema = Joi.object({
  id: common.id.required(),
});

// owner is absent — it is derived from req.user in the handler, never trusted from the body
const createRedirectSchema = Joi.object({
  path: slugPath.required(),
  url: url.required(),
  group: group,
  permission: permission,
  categories: categories,
});

// path and owner are absent — path is immutable post-creation (prevents namespace escalation
// and uniqueness bypass); owner is derived from req.user, never trusted from the body
const updateRedirectSchema = Joi.object({
  url: url,
  permission: permission,
  categories: categories,
});

const deleteRedirectSchema = Joi.object({
  id: common.id.required(),
});

module.exports = {
  getRedirectQuerySchema,
  getRedirectSchema,
  createRedirectSchema,
  updateRedirectSchema,
  deleteRedirectSchema,
};
