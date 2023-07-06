const config = require('../../config');
const Redirect = require('../models/redirect.model');
const { redirectParser } = require('../parsers/redirect.parsers');
const FireStoreAdapter = require('../../lib/firestore');
const boom = require('@hapi/boom');

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
    const query = await this.db.collection.where('path', '==', path);
    const snapshot = await query.get();
    if (snapshot.empty) {
      throw boom.notFound('Resource not found');
    }
    return redirectParser(snapshot.docs[0]);
  }
}

module.exports = RedirectService;
