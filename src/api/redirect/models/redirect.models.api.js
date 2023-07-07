class Redirect {
  /**
   * Create a Redirect object
   * @param {Object} data
   * @param {string} [data.id]
   * @param {string} data.path
   * @param {string} data.url
   * @param {string} data.owner
   * @param {string[]} [data.permission]
   * @param {string[]} [data.categories]
   * @param {Date} [data.created]
   * @param {Date} [data.updated]
   */
  constructor(data) {
    const { id, path, url, owner, permission, categories, created, updated } =
      data;
    this.id = id || null;
    this.path = path;
    this.url = url;
    this.owner = owner;
    if (permission) this.permission = permission;
    if (categories) this.categories = categories;
    if (created) this.created = created;
    if (updated) this.updated = updated;
  }
}

module.exports = Redirect;
