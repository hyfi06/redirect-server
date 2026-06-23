const crypto = require('crypto');
const express = require('express');
const boom = require('@hapi/boom');
const validatorHandler = require('../../../middleware/validator.handler');
const ApiKey = require('../models/api-key.model');
const ApiKeyService = require('../services/api-key.service');
const { createApiKeySchema, deleteApiKeySchema } = require('../schemas/api-key.schema');
const { nodeCache } = require('../../../utils/cache');

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
// Scopes that require admin role — Joi accepts them for all users; the role check
// lives here because it depends on req.user.role, not just the request body.
const ADMIN_ONLY_SCOPES = ['read:users', 'write:users', 'read:groups', 'write:groups'];

/**
 * Generates a cryptographically random base62 string of the given length.
 * Uses rejection sampling to eliminate modulo bias (rejects bytes >= 186).
 * @param {number} length
 * @returns {string}
 */
function randomBase62(length) {
  let result = '';
  while (result.length < length) {
    const bytes = crypto.randomBytes(length - result.length + 8);
    for (let i = 0; i < bytes.length && result.length < length; i++) {
      if (bytes[i] < 186) {
        result += BASE62[bytes[i] % 62];
      }
    }
  }
  return result;
}

const apiKeyService = new ApiKeyService();

const apiKeyRouter = express.Router();

apiKeyRouter.get('/', async (req, res, next) => {
  try {
    const keys = await apiKeyService.list(req.user.userId);
    res.status(200).json({ message: 'api keys retrieved', data: keys.map((k) => k.toPublic()) });
  } catch (error) {
    next(error);
  }
});

apiKeyRouter.post('/', validatorHandler(createApiKeySchema, 'body'), async (req, res, next) => {
  const { name, scopes, expiresAt } = req.body;

  if (req.user.role !== 'admin' && scopes.some((s) => ADMIN_ONLY_SCOPES.includes(s))) {
    return next(boom.forbidden('Admin scopes require admin role'));
  }

  try {
    let savedKey, token;
    // Retry loop handles the astronomically unlikely hash collision (service throws 409).
    while (true) {
      token = 'sk_1kg_' + randomBase62(32);
      const keyHash = crypto.createHash('sha256').update(token).digest('hex');
      const apiKey = new ApiKey({
        name,
        keyHash,
        prefix: token.slice(0, 8),
        scopes,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      });
      try {
        savedKey = await apiKeyService.create(req.user.userId, apiKey);
        break;
      } catch (err) {
        if (err.isBoom && err.output.statusCode === 409) continue;
        throw err;
      }
    }
    res.status(201).json({ message: 'api key created', data: { ...savedKey.toPublic(), token } });
  } catch (error) {
    next(error);
  }
});

apiKeyRouter.delete(
  '/:keyId',
  validatorHandler(deleteApiKeySchema, 'params'),
  async (req, res, next) => {
    try {
      const keyHash = await apiKeyService.revoke(req.user.userId, req.params.keyId);
      nodeCache.del(keyHash);
      res.status(200).json({ message: 'api key revoked', data: { id: req.params.keyId } });
    } catch (error) {
      next(error);
    }
  },
);

module.exports = { apiKeyRouter };
