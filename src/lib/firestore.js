const { Firestore } = require('@google-cloud/firestore');
const config = require('../config');
const boom = require('@hapi/boom');

class FireStoreAdapter {
  /**
   * @param {string} collection
   */
  constructor(collection) {
    this.db = new Firestore({
      projectId: config.projectId,
    });
    this.collection = this.db.collection(collection);
  }

  /**
   * Get document data by id
   * @param {string} id
   * @returns {Object}
   */
  async getById(id) {
    const docRef = this.collection.doc(id);
    const doc = await docRef.get();
    if (!doc.exists) {
      throw boom.notFound('Resource not found');
    } else {
      return doc.data();
    }
  }

  /**
   * Create new document
   * @param {string} id
   * @param {Object} data
   * @returns {string}
   */
  async create(id, data) {
    const docRef = await this.collection.doc(id);
    try {
      await docRef.create({
        created: Date.now(),
        update: Date.now(),
        ...data,
      });
    } catch (err) {
      throw boom.conflict(`Document already created with id ${id}`);
    }
    return await docRef.id;
  }

  /**
   * Update document
   * @param {string} id
   * @param {Object} data
   * @returns {Object}
   */
  async update(id, data) {
    const docRef = await this.collection.doc(id);
    await docRef.set({
      update: Date.now(),
      ...data,
    });
    return await docRef.get().data();
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
