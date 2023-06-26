const config = require('../../config');
const UrnModel = require('../../../models/urn');
const boom = require('@hapi/boom');

const FireStoreAdapter = require('../../../lib/firestore');

const fireStoreAdapter = new FireStoreAdapter(config.firestore.collections.urn);

class RedirectorService {
  constructor() {
    this.collection = config.dbCollection;
    this.db = new FirestoreLib();
  }

  async getUrl(urn) {
    const data = await this.db.get(this.collection, urn);
    return data.url;
  }
}

class RedirectService {
  constructor() {
    this.db = new Firestore({
      projectId: config.firestore.projectId,
      credentials: config.firestore.credentials,
    });
    this.collection = this.db.collection(config.firestore.collections.urn);
  }

  async getByUrn(urn) {
    const urnModel = new UrnModel({
      urn,
    });
    const docRef = this.collection.doc(urnModel.id);
    const doc = docRef.get();
    if (!doc.exists) {
      throw boom.notFound('Resource not found');
    }
    return new UrnModel(doc);
  }
  /**
   *
   * @param {Urn} data
   */
  async create(data) {
    const newDoc = await this.collection.doc(data.id).create(data);
    return newDoc ? newDoc.id : undefined;
  }
}

module.exports = RedirectorService;
