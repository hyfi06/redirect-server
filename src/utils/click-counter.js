const Firestore = require('@google-cloud/firestore');
const firestoreClient = require('../lib/firestore-client');
const config = require('../config');
const { log } = require('./logger');

// N=10: ≤9 clicks lost on crash (acceptable for personal analytics) and 10× fewer writes than N=1.
const FLUSH_THRESHOLD = 10;

/** @type {Map<string, number>} */
const counters = new Map();

/**
 * Writes a snapshot of counters to Firestore using FieldValue.increment.
 * Always resolves — errors are logged, not propagated.
 * @param {Map<string, number>} snapshot
 * @returns {Promise<void>}
 */
async function _writeCounters(snapshot) {
  const collection = firestoreClient.collection(config.firestore.collections.redirects);
  try {
    await Promise.all(
      Array.from(snapshot.entries()).map(([redirectId, count]) =>
        collection.doc(redirectId).update({ clickCount: Firestore.FieldValue.increment(count) })
      )
    );
  } catch (err) {
    log('ERROR', 'click-counter: Firestore flush failed', { error: err.message });
  }
}

/**
 * Increments the in-memory click counter for a redirect.
 * Flushes to Firestore (fire-and-forget) when the threshold is reached.
 * @param {string} redirectId
 */
function increment(redirectId) {
  const current = (counters.get(redirectId) || 0) + 1;
  if (current >= FLUSH_THRESHOLD) {
    counters.delete(redirectId);
    _writeCounters(new Map([[redirectId, current]]));
  } else {
    counters.set(redirectId, current);
  }
}

/**
 * Flushes all pending counters to Firestore.
 * No-op if there are no pending counters.
 * @returns {Promise<void>}
 */
async function flushAll() {
  if (counters.size === 0) return;
  const snapshot = new Map(counters);
  counters.clear();
  await _writeCounters(snapshot);
}

/**
 * Returns a copy of the current counter map. For tests only.
 * @returns {Map<string, number>}
 */
function getCounters() {
  return new Map(counters);
}

module.exports = { increment, flushAll, getCounters };
