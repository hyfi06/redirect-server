const crypto = require('crypto');
const boom = require('@hapi/boom');
const { verify } = require('../utils/auth/jwt');
const { nodeCache } = require('../utils/cache');
const ApiKeyService = require('../api/users/services/api-key.service');
const UserServices = require('../api/users/services/user.service');

const apiKeyService = new ApiKeyService();
const userService = new UserServices();

/**
 * @param {string} token
 * @param {import('express').Request} req
 * @param {import('express').NextFunction} next
 */
async function authenticateApiKey(token, req, next) {
  try {
    const keyHash = crypto.createHash('sha256').update(token).digest('hex');

    const cached = nodeCache.get(keyHash);
    if (cached !== undefined) {
      req.user = cached;
      return next();
    }

    const result = await apiKeyService.findByHash(keyHash);
    if (!result) {
      return next(boom.unauthorized('Invalid API key'));
    }

    if (!result.apiKey.active) {
      return next(boom.unauthorized('API key revoked'));
    }

    if (result.apiKey.expiresAt !== null && result.apiKey.expiresAt <= new Date()) {
      return next(boom.unauthorized('API key expired'));
    }

    const user = await userService.findOne(result.userId);

    req.user = {
      userId: user.id,
      email: user.email,
      role: user.role,
      groups: user.groups,
      apiKey: { id: result.apiKey.id, scopes: result.apiKey.scopes },
    };

    // TTL 30s: a revoked key remains valid for up to 30 seconds after revocation.
    // This is an accepted trade-off between cost (one Firestore read per 30s window)
    // and revocation latency. The DELETE endpoint also calls nodeCache.del(keyHash)
    // to provide best-effort immediate invalidation within the same instance.
    nodeCache.set(keyHash, req.user, 30);
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * @param {string} token
 * @param {import('express').Request} req
 * @param {import('express').NextFunction} next
 */
function authenticateJwt(token, req, next) {
  try {
    req.user = verify(token);
    next();
  } catch {
    next(boom.unauthorized('Invalid token'));
  }
}

/**
 * Verifies the Bearer token in the Authorization header and sets req.user.
 * Dispatches to API key or JWT authentication based on the token prefix.
 * Must be applied before any middleware that reads req.user (e.g. authorize).
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next(boom.unauthorized('Missing token'));
  }

  const token = authHeader.slice(7);

  if (token.startsWith('sk_1kg_')) {
    return authenticateApiKey(token, req, next);
  }

  return authenticateJwt(token, req, next);
}

module.exports = { authenticate };
