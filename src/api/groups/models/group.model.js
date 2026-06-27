class Group {
  /**
   * @param {Object} data
   * @param {string} data.id
   * @param {string} data.name
   * @param {string} data.slug
   * @param {string[]} [data.users] — Firestore document IDs of member User documents
   * @param {Date | null} [data.deletedAt] — null means active; Date means soft-deleted
   * @param {Date} [data.created]
   * @param {Date} [data.updated]
   */
  constructor({ id, name, slug, users, deletedAt, created, updated }) {
    this.id = id || null;
    this.name = name;
    this.slug = slug;
    // undefined → cleanDocObject omits the field in PATCH; [] explicitly empties the group
    this.users = users;
    this.deletedAt = deletedAt ?? null;
    if (created) this.created = created;
    if (updated) this.updated = updated;
  }
}

module.exports = { Group };
