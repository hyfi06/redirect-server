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

  /**
   * @param {object} [options]
   * @param {string} [options.orderBy] - Field to sort by; prefix "-" for descending
   * @param {number} [options.offset]
   * @param {number} [options.limit]
   * @returns {Promise<T[]>}
   */
  async getAll(options) {
    const { orderBy, offset, limit } = options;
    const fsCollection = this.db.collection;
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
   * Find docs matching a Firestore where() filter. Always applies
   * orderBy('updated', 'desc') unless options.orderBy is provided.
   * @template T
   * @param {Array} [query] - Arguments spread into collection.where(); omit to match all docs
   * @param {object} [options]
   * @param {string} [options.orderBy] - Field to sort by; prefix "-" for descending
   * @param {number} [options.offset]
   * @param {number} [options.limit]
   * @returns {Promise<T[]>}
   */
  async find(query, options) {
    const { orderBy, offset, limit } = options;
    let fsQuery = this.db.collection;
    if (query) {
      fsQuery = fsQuery.where(...query);
    }
    if (!orderBy) {
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
