/**
 * E2E seed helpers.
 * Creates the fixed admin user directly in Firestore — bypasses the API because
 * there is no bootstrap admin to authenticate the first POST /users request.
 * Uses `set` (not `create`) so the operation is idempotent across test runs.
 */
require('dotenv').config();
const { Timestamp } = require('@google-cloud/firestore');
const firestoreClient = require('../../src/lib/firestore-client');

const ADMIN_USER_ID = 'e2e-admin-001';

/**
 * Upserts the fixed E2E admin user in Firestore.
 * Safe to call multiple times — subsequent calls overwrite the same document.
 * @returns {Promise<void>}
 */
async function createAdmin() {
  await firestoreClient.collection('users').doc(ADMIN_USER_ID).set({
    email: 'e2e-admin@e2e.example.com',
    firstName: 'E2E',
    lastName: 'Admin',
    role: 'admin',
    groups: [],
    deletedAt: null,
    created: Timestamp.now(),
    updated: Timestamp.now(),
  });
}

module.exports = { createAdmin, ADMIN_USER_ID };
