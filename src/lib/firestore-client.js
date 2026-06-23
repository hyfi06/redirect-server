const Firestore = require('@google-cloud/firestore');

// Node.js module caching guarantees a single instance across all require() calls —
// every FireStoreAdapter shares this client, enabling cross-collection batch writes.
const firestoreClient = new Firestore.Firestore();

module.exports = firestoreClient;
