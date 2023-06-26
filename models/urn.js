const { OWNER_SCOPES, Scope } = require('./scope');
class Urn {
  /**
   * Create a Urn object
   * @param {Object} data
   * @param {string} data.id
   * @param {string} data.urn
   * @param {string} data.url
   * @param {string} data.owner
   * @param {Scope[]} data.scopes
   * @param {string[]} data.categories
   * @param {Date} data.created
   * @param {Date} data.updated
   *
   */
  constructor(data) {
    const { id, urn, url, owner, scopes, categories, created, updated } = data;

    this.id = id || urn?.replace('/', '|');
    if (urn) this.urn_ = urn;
    this.url = url;
    this.owner = owner;
    this.scopes = scopes || [OWNER_SCOPES];
    this.categories = categories || [];
    if (created) this.created = created;
    this.updated = updated || new Date();
  }

  /**
   * Get urn property
   * @returns {string}
   */
  get urn() {
    return this.urn_ || this.id.replace('|', '/');
  }

  /**
   * Set urn property
   * @param {string} urn
   */
  set urn(urn) {
    this.id = urn.replace('/', '|');
    this.urn_ = urn;
  }
}
