const ApiKey = require('../models/api-key.model');

/**
 * Parses a Firestore DocumentSnapshot into an ApiKey instance.
 * @param {import('@google-cloud/firestore').DocumentSnapshot} docSnap
 * @returns {ApiKey}
 */
function apiKeyDocParser(docSnap) {
  const id = docSnap.ref.id;
  const data = docSnap.data();
  return new ApiKey({
    ...data,
    id,
    createdAt: new Date(data.createdAt.toMillis()),
    lastUsedAt: data.lastUsedAt ? new Date(data.lastUsedAt.toMillis()) : null,
    expiresAt: data.expiresAt ? new Date(data.expiresAt.toMillis()) : null,
  });
}

/**
 * Prepares an ApiKey for Firestore creation.
 * @param {ApiKey} apiKey
 * @returns {Object}
 */
function createApiKeyParser(apiKey) {
  return {
    keyHash: apiKey.keyHash,
    prefix: apiKey.prefix,
    name: apiKey.name,
    scopes: apiKey.scopes,
    expiresAt: apiKey.expiresAt,
    active: true,
    lastUsedAt: null,
  };
}

/**
 * Prepares an ApiKey for revocation (sets active to false).
 * @returns {Object}
 */
function updateApiKeyParser() {
  return { active: false };
}

module.exports = { apiKeyDocParser, createApiKeyParser, updateApiKeyParser };
