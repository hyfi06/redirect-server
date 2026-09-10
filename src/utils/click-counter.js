const Firestore = require('@google-cloud/firestore');
const firestoreClient = require('../lib/firestore-client');
const config = require('../config');
const { log } = require('./logger');

/**
 * Increments a redirect's click count directly in Firestore. Fire-and-forget —
 * the caller does not await this; errors are logged, never propagated.
 * @param {string} redirectId
 */
function increment(redirectId) {
  firestoreClient
    .collection(config.firestore.collections.redirects)
    .doc(redirectId)
    .update({ clickCount: Firestore.FieldValue.increment(1) })
    .catch((err) => {
      log('ERROR', 'click-counter: Firestore write failed', { error: err.message });
    });
}

module.exports = { increment };
