const Joi = require('joi');

const createGroupSchema = Joi.object({
  name: Joi.string().required(),
  slug: Joi.string().lowercase().pattern(/^[a-z0-9-]+$/).required(),
  // users: Firestore document IDs of User documents (not email strings)
  users: Joi.array().items(Joi.string()),
}).options({ allowUnknown: false });

// slug is intentionally absent — it is immutable after creation (D7/D13)
const updateGroupSchema = Joi.object({
  name: Joi.string(),
  // users: Firestore document IDs of User documents (not email strings)
  users: Joi.array().items(Joi.string()),
}).options({ allowUnknown: false });

const idParamSchema = Joi.object({
  id: Joi.string().required(),
}).options({ allowUnknown: false });

const getGroupQuerySchema = Joi.object({
  orderBy: Joi.string(),
  offset: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1),
  inactive: Joi.boolean(),
}).options({ allowUnknown: false });

module.exports = {
  createGroupSchema,
  updateGroupSchema,
  idParamSchema,
  getGroupQuerySchema,
};
