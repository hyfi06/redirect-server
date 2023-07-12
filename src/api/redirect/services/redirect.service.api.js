const config = require('../../../config');
const CrudService = require('../../../utils/crud.service');
const Redirect = require('../models/redirect.models.api');
const {
  redirectParser,
  createRedirectParser,
  updateRedirectParser,
} = require('../parsers/redirect.parser.api');
const boom = require('@hapi/boom');

class RedirectServiceApi extends CrudService {
  constructor() {
    super(
      config.firestore.collections.redirects,
      redirectParser,
      createRedirectParser,
      updateRedirectParser,
    );
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
    return this.docParser(snapshot.docs[0]);
  }

  /**
   * Create redirect doc
   * @param {Redirect} redirect
   * @returns {Redirect}
   */
  async create(redirect) {
    try {
      await this.getByPath(redirect.path.replace(/\/$/, ''));
    } catch (error) {
      const newDoc = await this.db.create(this.createParser(redirect));
      return this.docParser(newDoc);
    }
    throw boom.badRequest('Path already taken');
  }
}

module.exports = RedirectServiceApi;
