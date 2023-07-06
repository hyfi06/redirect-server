const Firestore = require('@google-cloud/firestore');
const boom = require('@hapi/boom');

class FireStoreAdapter {
  /**
   * @param {string} collection
   */
  constructor(collection) {
    this.db = new Firestore.Firestore();
    this.collection = this.db.collection(collection);
  }

  /**
   * Get document data by id
   * @param {string} id
   * @returns {Firestore.DocumentSnapshot}
   */
  async get(id) {
    const docRef = this.collection.doc(id);
    const doc = await docRef.get();
    if (!doc.exists) {
      throw boom.notFound('Resource not found');
    } else {
      return doc;
    }
  }

  /**
   * Create new document
   * @param {string} id
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
   * Update document
   * @param {string} id
   * @param {Object} data
   * @returns {Firestore.DocumentSnapshot}
   */
  async update(id, data) {
    const docRef = await this.collection.doc(id);
    await docRef.set({
      updated: Firestore.Timestamp.fromMillis(Date.now()),
      ...data,
    });
    return await docRef.get();
  }

  /**
   * Delete document by id
   * @param {string} id
   * @returns {string}
   */
  async delete(id) {
    const docRef = await this.collection.doc(id);
    await docRef.delete();
    return id;
  }
}

module.exports = FireStoreAdapter;
