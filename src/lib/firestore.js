// Firestore is still required for Firestore.Timestamp — the client instance comes from the singleton.
const Firestore = require('@google-cloud/firestore');
const boom = require('@hapi/boom');
const firestoreClient = require('./firestore-client');

class FireStoreAdapter {
  /**
   * @param {string} collection
   */
  constructor(collection) {
    this.db = firestoreClient;
    this.collection = this.db.collection(collection);
  }

  /**
   * Get document data by id
   * @param {string} id
   * @returns {Firestore.DocumentSnapshot}
   */
  async get(id) {
    const docRef = this.collection.doc(id);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      throw boom.notFound('Resource not found');
    } else {
      return docSnap;
    }
  }

  /**
   * Create new document
   * @param {Object} data
   * @returns {Firestore.DocumentSnapshot}
   */
  async create(data) {
    try {
      const docRef = await this.collection.add({
        created: Firestore.Timestamp.fromMillis(Date.now()),
        updated: Firestore.Timestamp.fromMillis(Date.now()),
        ...data,
      });
      return await docRef.get();
    } catch (err) {
      throw boom.badRequest('Error in data', err);
    }
  }

  /**
   * Update document. No existence check before writing — Firestore throws a
   * gRPC error (code 5 = NOT_FOUND) when the document does not exist, which is
   * caught and converted to boom.notFound. The post-update get() is intentional:
   * it returns the document as Firestore sees it so docParser receives a
   * consistent DocumentSnapshot regardless of concurrent writes.
   * @param {string} id
   * @param {Object} data
   * @returns {Promise<Firestore.DocumentSnapshot>}
   */
  async update(id, data) {
    const docRef = this.collection.doc(id);
    try {
      await docRef.update({
        updated: Firestore.Timestamp.fromMillis(Date.now()),
        ...data,
      });
    } catch (err) {
      // gRPC status code 5 = NOT_FOUND; any other code is an unexpected error
      if (err.code === 5) throw boom.notFound('Resource not found');
      throw err;
    }
    return await docRef.get();
  }

  /**
   * Delete document by id
   * @param {string} id
   * @returns {string}
   */
  async delete(id) {
    const docRef = this.collection.doc(id);
    if (!(await docRef.get()).exists) {
      throw boom.notFound('Resource not found');
    }
    await docRef.delete();
    return id;
  }
}

module.exports = FireStoreAdapter;
