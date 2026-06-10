class Group {
  /**
   * @param {Object} data
   * @param {string} data.id
   * @param {string} data.name
   * @param {string} data.slug
   * @param {string[]} [data.users]
   * @param {Date} [data.created]
   * @param {Date} [data.updated]
   */
  constructor({ id, name, slug, users, created, updated }) {
    this.id = id || null;
    this.name = name;
    this.slug = slug;
    // undefined → cleanDocObject omits the field in PATCH; [] explicitly empties the group
    this.users = users;
    if (created) this.created = created;
    if (updated) this.updated = updated;
  }
}

module.exports = { Group };
