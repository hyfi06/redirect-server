const { OWNER_SCOPES, Scope } = require('./scope');

class Redirect {
  /**
   * Create a Redirect object
   * @param {Object} data
   * @param {string} data.id
   * @param {string} data.path
   * @param {string} data.url
   * @param {string|FirebaseFirestore.DocumentReference} data.owner
   * @param {Scope[]} data.scopes
   * @param {string[]} data.categories
   * @param {Date|FirebaseFirestore.Timestamp} data.created
   * @param {Date|FirebaseFirestore.Timestamp} data.updated
   */
  constructor(data) {
    const { id, path, url, owner, scopes, categories, created, updated } = data;

    this.id = id || path?.replace(/\//g, '|');
    if (path) this.path_ = path;
    this.url = url;
    this.owner = owner;
    this.scopes = scopes || [OWNER_SCOPES];
    this.categories = categories || [];
    if (created) this.created = created.toDate?.() || created;
    this.updated = updated?.toDate?.() || updated || new Date();
  }

  /**
   * Get urn property
   * @returns {string}
   */
  get path() {
    return this.path_ || this.id.replace('|', '/');
  }

  /**
   * Set urn property
   * @param {string} path
   */
  set path(urn) {
    this.id = path.replace('/', '|');
    this.path_ = path;
  }
}

module.exports = Redirect;
