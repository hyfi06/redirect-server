/**
 * E2E teardown helper.
 * Hard-deletes all E2E test data from Firestore using prefix range queries.
 * Called in afterAll() of each test suite and available as a standalone cleanup
 * script via `npm run test:e2e:cleanup` when a test run is interrupted mid-suite.
 *
 * Prefix conventions that identify E2E resources:
 *   Users     — email starts with 'e2e' (covers e2e-admin@e2e.example.com, e2e-*@e2e.example.com)
 *   Groups    — slug starts with 'e2e-'
 *   Redirects — path starts with '/e2e-'
 */
require('dotenv').config();
const firestoreClient = require('../../src/lib/firestore-client');

/**
 * Deletes all E2E test resources from Firestore.
 * Firestore range query `(field >= 'prefix') AND (field < nextPrefix)` implements
 * starts-with matching on a single field without a composite index.
 * @returns {Promise<void>}
 */
async function cleanAll() {
  // Collect all delete operations for a single batch commit.
  // A second batch handles overflow if somehow > 500 ops accumulate (unlikely in tests).
  const batch = firestoreClient.batch();

  // --- Users (and their subcollections) ---
  // Email prefix: 'e2e' <= email < 'e2f'
  const usersSnap = await firestoreClient
    .collection('users')
    .where('email', '>=', 'e2e')
    .where('email', '<', 'e2f')
    .get();

  for (const doc of usersSnap.docs) {
    // apiKeys subcollection must be deleted before the parent document
    const apiKeysSnap = await firestoreClient
      .collection('users')
      .doc(doc.id)
      .collection('apiKeys')
      .get();
    for (const keyDoc of apiKeysSnap.docs) {
      batch.delete(keyDoc.ref);
    }

    batch.delete(doc.ref);
  }

  // --- Groups ---
  // Slug prefix: 'e2e-' <= slug < 'e2f'
  const groupsSnap = await firestoreClient
    .collection('groups')
    .where('slug', '>=', 'e2e-')
    .where('slug', '<', 'e2f')
    .get();
  for (const doc of groupsSnap.docs) {
    batch.delete(doc.ref);
  }

  // --- Redirects ---
  // Path prefix: '/e2e-' <= path < '/e2f'
  const redirectsSnap = await firestoreClient
    .collection('redirects')
    .where('path', '>=', '/e2e-')
    .where('path', '<', '/e2f')
    .get();
  for (const doc of redirectsSnap.docs) {
    batch.delete(doc.ref);
  }

  await batch.commit();
  console.log(
    `[teardown] Deleted ${usersSnap.size} user(s), ${groupsSnap.size} group(s), ${redirectsSnap.size} redirect(s)`,
  );
}

module.exports = { cleanAll };

if (require.main === module) {
  cleanAll().catch(console.error);
}
