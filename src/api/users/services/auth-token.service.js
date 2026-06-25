const { Firestore } = require('@google-cloud/firestore');
const firestoreClient = require('../../../lib/firestore-client');

class AuthTokenService {
  /**
   * @param {string} userId
   * @returns {import('@google-cloud/firestore').DocumentReference}
   */
  _docRef(userId) {
    return firestoreClient.collection('users').doc(userId).collection('auth').doc('google');
  }

  /**
   * Reads auth tokens for a user.
   * @param {string} userId
   * @returns {Promise<Object|null>}
   */
  async read(userId) {
    const snap = await this._docRef(userId).get();
    if (!snap.exists) return null;
    return snap.data();
  }

  /**
   * Writes auth tokens for a user (merges with existing data).
   * @param {string} userId
   * @param {Object} tokens
   * @returns {Promise<void>}
   */
  async write(userId, tokens) {
    await this._docRef(userId).set(
      { ...tokens, updatedAt: Firestore.Timestamp.fromMillis(Date.now()) },
      { merge: true },
    );
  }
}

module.exports = AuthTokenService;
