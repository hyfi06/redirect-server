/**
 * E2E auth helpers.
 * Generates JWTs directly using the same sign() function the server uses,
 * bypassing the Google OAuth2 flow which requires browser interaction.
 *
 * dotenv is loaded before importing jwt.js so JWT_SECRET from .env is available
 * when config/index.js reads process.env.JWT_SECRET.
 */
require('dotenv').config();
const { sign } = require('../../src/utils/auth/jwt');

const ADMIN_USER_ID = 'e2e-admin-001';

/**
 * @returns {string} signed JWT for the fixed E2E admin user
 */
function adminToken() {
  return sign({
    userId: ADMIN_USER_ID,
    email: 'e2e-admin@e2e.test',
    role: 'admin',
    groups: [],
  });
}

/**
 * @param {string} userId  Firestore document ID of the user
 * @param {string[]} [groups]  group slugs the user belongs to
 * @returns {string} signed JWT for a regular E2E user
 */
function userToken(userId, groups = []) {
  return sign({
    userId,
    email: `${userId}@e2e.test`,
    role: 'user',
    groups,
  });
}

module.exports = { adminToken, userToken, ADMIN_USER_ID };
