const { Firestore } = require('@google-cloud/firestore');
const boom = require('@hapi/boom');
const firestoreClient = require('../../../lib/firestore-client');
const {
  apiKeyDocParser,
  createApiKeyParser,
} = require('../parsers/api-key.parser');

class ApiKeyService {
  /**
   * @param {string} userId
   * @returns {import('@google-cloud/firestore').CollectionReference}
   */
  _collection(userId) {
    return firestoreClient.collection('users').doc(userId).collection('apiKeys');
  }

  /**
   * @param {string} userId
   * @returns {Promise<import('../models/api-key.model')[]>}
   */
  async list(userId) {
    const snap = await this._collection(userId).orderBy('createdAt', 'desc').get();
    if (snap.empty) return [];
    return snap.docs.map(apiKeyDocParser);
  }

  /**
   * @param {string} userId
   * @param {import('../models/api-key.model')} apiKey
   * @returns {Promise<import('../models/api-key.model')>}
   */
  async create(userId, apiKey) {
    const activeSnap = await this._collection(userId).where('active', '==', true).get();
    if (activeSnap.size >= 10) {
      throw boom.badRequest('API key limit reached (10)');
    }
    const docData = {
      ...createApiKeyParser(apiKey),
      createdAt: Firestore.Timestamp.fromMillis(Date.now()),
    };
    const docRef = await this._collection(userId).add(docData);
    return apiKeyDocParser(await docRef.get());
  }

  /**
   * Revokes an API key and returns its hash for cache invalidation.
   * @param {string} userId
   * @param {string} keyId
   * @returns {Promise<string>} keyHash
   */
  async revoke(userId, keyId) {
    const docRef = this._collection(userId).doc(keyId);
    const doc = await docRef.get();
    if (!doc.exists) {
      throw boom.notFound('API key not found');
    }
    const keyHash = doc.data().keyHash;
    await docRef.update({ active: false });
    return keyHash;
  }

  /**
   * Looks up an API key across all users by its hash.
   * @param {string} keyHash
   * @returns {Promise<{apiKey: import('../models/api-key.model'), userId: string}|null>}
   */
  async findByHash(keyHash) {
    const snap = await firestoreClient
      .collectionGroup('apiKeys')
      .where('keyHash', '==', keyHash)
      .limit(1)
      .get();
    if (snap.empty) return null;
    const docSnap = snap.docs[0];
    const userId = docSnap.ref.parent.parent.id;
    return { apiKey: apiKeyDocParser(docSnap), userId };
  }
}

module.exports = ApiKeyService;
