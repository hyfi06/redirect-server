const Firestore = require('@google-cloud/firestore');
const config = require('../redirect-server/config');
const boom = require('@hapi/boom');

class FireStoreAdapter {
  /**
   * @param {string} collection
   */
  constructor(collection) {
    this.db = new Firestore({
      projectId: config.projectId,
      credentials: config.credentials,
    });
    this.collection = this.db.collection(collection);
  }

  async getById(id) {
    const docRef = this.collection.doc(id);
    const doc = await docRef.get();
    if (!doc.exists) {
      throw boom.notFound('Resource not found');
    } else {
      return doc.data();
    }
  }

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

  async update(id, data) {
    const docRef = await this.collection.doc(id);
    await docRef.set({
      update: Date.now(),
      ...data,
    });
  }
}

module.exports = FireStoreAdapter;
