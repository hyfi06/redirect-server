class ApiKey {
  /**
   * @param {Object} data
   * @param {string|null} data.id
   * @param {string} data.name
   * @param {string} data.keyHash
   * @param {string} data.prefix
   * @param {string[]} data.scopes
   * @param {Date|null} data.expiresAt
   * @param {Date} data.createdAt
   * @param {Date|null} data.lastUsedAt
   * @param {boolean} data.active
   */
  constructor({ id, name, keyHash, prefix, scopes, expiresAt, createdAt, lastUsedAt, active }) {
    this.id = id || null;
    this.name = name;
    this.keyHash = keyHash;
    this.prefix = prefix;
    this.scopes = scopes || [];
    this.expiresAt = expiresAt !== undefined ? expiresAt : null;
    if (createdAt) this.createdAt = createdAt;
    this.lastUsedAt = lastUsedAt !== undefined ? lastUsedAt : null;
    this.active = active !== undefined ? active : true;
  }

  /**
   * Returns a plain object safe for JSON responses (no keyHash).
   * @returns {Object}
   */
  toPublic() {
    return {
      id: this.id,
      name: this.name,
      prefix: this.prefix,
      scopes: this.scopes,
      expiresAt: this.expiresAt,
      createdAt: this.createdAt,
      lastUsedAt: this.lastUsedAt,
      active: this.active,
    };
  }
}

module.exports = ApiKey;
