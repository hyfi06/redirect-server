const config = require('../config');
const UrnModel = require('../models/urn');
const FireStoreAdapter = require('../lib/firestore');

class RedirectService {
  constructor() {
    this.db = new FireStoreAdapter(config.firestore.collections.urn);
  }

  /**
   * Get by urn
   * @param {string} urn
   * @returns {UrnModel}
   */
  async getByUrn(urn) {
    const input = new UrnModel({ urn });
    const doc = await this.db.getById(input.id);
    return new UrnModel(doc);
  }

  /**
   * Create urn
   * @param {UrnModel} data
   * @returns {string}
   */
  async create(data) {
    const newDocId = await this.db.create(data.id, data);
    return newDocId;
  }
}

module.exports = RedirectService;
