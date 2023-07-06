const Redirect = require('../models/redirect.models.api');
const {
  createRedirectParser,
  redirectParser,
  updateRedirectParser,
} = require('../parsers/redirect.parsers.api');

class RedirectServiceApi {
  constructor() {
    super();
  }

  /**
   * Create redirect doc
   * @param {Redirect} redirect
   * @returns {Redirect}
   */
  async create(redirect) {
    const newDoc = await this.db.create(createRedirectParser(redirect));
    return redirectParser(newDoc);
  }

  /**
   * find docs by query
   * @param {string[]} query
   * @param {string} options.orderBy
   * @param {number} options.offset
   * @param {number} options.limit
   * @return {Redirect[]}
   */
  async find(query, options) {
    const { orderBy, offset, limit } = options;
    const fsQuery = await this.db.collection.where(...query);
    let fsFilter = fsQuery;
    if (orderBy) {
      fsFilter = fsFilter.orderBy(orderBy);
    }
    if (offset) {
      fsFilter = fsFilter.offset(offset);
    }
    if (limit) {
      fsFilter = fsFilter.limit(limit);
    }

    const querySnap = await fsFilter.get();
    if (querySnap.empty) {
      return [];
    }
    return querySnap.docs.map((doc) => redirectParser(doc));
  }

  /**
   * Find one by id
   * @param {string} id
   * @returns {Redirect}
   */
  async findOne(id) {
    const docSnap = await this.db.get(id);
    return redirectParser(docSnap);
  }

  /**
   * Update redirect doc
   * @param {Redirect} redirect
   * @return {Redirect} Updated redirect
   */
  async update(redirect) {
    const docSnap = await this.db.update(
      redirect.id,
      updateRedirectParser(redirect)
    );
    return redirectParser(docSnap);
  }

  async delete(id) {
    const deletedId = await this.db.delete(id);
    return deletedId;
  }
}

module.exports = RedirectServiceApi;
