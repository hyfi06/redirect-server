const config = require('../../config');
const Redirect = require('../models/redirect.model');
const FireStoreAdapter = require('../../lib/firestore');

class RedirectService {
  constructor() {
    this.db = new FireStoreAdapter(config.firestore.collections.redirects);
  }

  /**
   * Get by path
   * @param {string} path
   * @returns {Redirect}
   */
  async getByPath(path) {
    const redirect = new Redirect({ path });
    const doc = await this.db.getById(redirect.id);
    return new Redirect(doc.data());
  }

  /**
   * Create urn
   * @param {Redirect} data
   * @returns {string}
   */
  async create(data) {
    const newDoc = await this.db.create(data.id, data);
    return newDoc.id;
  }
}

module.exports = RedirectService;
