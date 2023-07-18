const FireStoreAdapter = require('../lib/firestore');

class CrudService {
  /**
   * @template T
   * @param {string} dbTable
   * @param {Function} docParser
   * @param {Function} createParser
   * @param {Function} updateParser
   */
  constructor(dbTable, docParser, createParser, updateParser) {
    this.db = new FireStoreAdapter(dbTable);
    this.docParser = docParser || ((o) => o);
    this.createParser = createParser || ((o) => o);
    this.updateParser = updateParser || ((o) => o);
  }

  /**
   * Create redirect doc
   * @template T
   * @param {T} data
   * @returns {T}
   */
  async create(data) {
    const newDoc = await this.db.create(this.createParser(data));
    return this.docParser(newDoc);
  }

  async getAll(options) {
    const { orderBy, offset, limit } = options;
    const fsCollection = await this.db.collection;
    let fsFilter;
    if (orderBy) {
      fsFilter = /^-/.test(orderBy)
        ? fsCollection.orderBy(orderBy.replace(/^-/, ''), 'desc')
        : fsCollection.orderBy(orderBy);
    } else {
      fsFilter = fsCollection.orderBy('updated', 'desc');
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
    return querySnap.docs.map((doc) => this.docParser(doc));
  }

  /**
   * find docs by query
   * @template T
   * @param {string[]} query
   * @param {string} options.orderBy
   * @param {number} options.offset
   * @param {number} options.limit
   * @return {T[]}
   */
  async find(query, options) {
    const { orderBy, offset, limit } = options;
    let fsQuery = this.db.collection;
    if (query) {
      fsQuery = fsQuery.where(...query);
    } else if (!orderBy) {
      fsQuery = fsQuery.orderBy('updated', 'desc');
    }
    let fsFilter = fsQuery;
    if (orderBy) {
      fsFilter = /^-/.test(orderBy)
        ? fsFilter.orderBy(orderBy.replace(/^-/, ''), 'desc')
        : fsFilter.orderBy(orderBy, 'asc');
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
    return querySnap.docs.map((doc) => this.docParser(doc));
  }

  /**
   * Find one by id
   * @template T
   * @param {string} id
   * @returns {T}
   */
  async findOne(id) {
    const docSnap = await this.db.get(id);
    return this.docParser(docSnap);
  }

  /**
   * Update redirect doc
   * @template T
   * @param {T} data
   * @return {T} Updated redirect
   */
  async update(data) {
    const docSnap = await this.db.update(data.id, this.updateParser(data));
    return this.docParser(docSnap);
  }

  /**
   * Delete redirect doc
   * @param {string} id
   * @returns {string}
   */
  async delete(id) {
    const deletedId = await this.db.delete(id);
    return deletedId;
  }
}

module.exports = CrudService;
