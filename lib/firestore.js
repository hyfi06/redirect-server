const Firestore = require('@google-cloud/firestore');
const config = require('../config');
const boom = require('@hapi/boom');

class FirestoreLib {
  constructor() {
    this.db = new Firestore({
      projectId: config.projectId,
      credentials: config.credentials,
    });
  }

  async get(collection, id) {
    const docRef = this.db.collection(collection).doc(id);
    const doc = await docRef.get();
    if (!doc.exists) {
      throw boom.notFound();
    } else {
      return doc.data();
    }
  }

  async create(collection, id, data) {
    const newDoc = await this.db.collection(collection).doc(id).create(data);
    return newDoc ? id : undefined;
  }
}

module.exports = FirestoreLib;
