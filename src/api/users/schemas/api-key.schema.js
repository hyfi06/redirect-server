const Joi = require('joi');

const VALID_SCOPES = [
  'read:redirects',
  'write:redirects',
  'read:users',
  'write:users',
  'read:groups',
  'write:groups',
];

const createApiKeySchema = Joi.object({
  name: Joi.string().max(100).required(),
  scopes: Joi.array().items(Joi.string().valid(...VALID_SCOPES)).min(1).required(),
  expiresAt: Joi.string().isoDate().allow(null).optional(),
});

const deleteApiKeySchema = Joi.object({
  keyId: Joi.string().required(),
});

module.exports = { createApiKeySchema, deleteApiKeySchema };
