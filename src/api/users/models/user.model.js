class User {
  /**
   * @param {Object} data
   * @param {string} [data.id]
   * @param {string} [data.email]
   * @param {string} [data.firstName] — undefined when omitted; omitted fields are stripped by cleanDocObject on PATCH (D20)
   * @param {string} [data.lastName] — undefined when omitted; omitted fields are stripped by cleanDocObject on PATCH (D20)
   * @param {string[]} [data.groups] — undefined when omitted; omitted fields are stripped by cleanDocObject on PATCH (D20)
   * @param {string} [data.role]
   * @param {Date | null} [data.deletedAt] — null means active; Date means soft-deleted
   * @param {Date} [data.created]
   * @param {Date} [data.updated]
   */
  constructor(data) {
    const { id, email, firstName, lastName, groups, role, deletedAt, created, updated } = data;
    this.id = id || null;
    this.email = email ? email.toLowerCase().trim() : undefined;
    // No default — undefined in a PATCH body must remain undefined so cleanDocObject omits it (D20)
    this.firstName = firstName?.trim() || undefined;
    // No default — undefined in a PATCH body must remain undefined so cleanDocObject omits it (D20)
    this.lastName = lastName?.trim() || undefined;
    // No default — groups: undefined in a PATCH body must remain undefined so cleanDocObject omits it (D20)
    this.groups = groups;
    // No default — role: undefined in a PATCH body must remain undefined so cleanDocObject omits it (D20)
    this.role = role;
    this.deletedAt = deletedAt ?? null;
    if (created) this.created = created;
    if (updated) this.updated = updated;
  }

  /**
   * @returns {string}
   */
  get fullNameByName() {
    return [this.firstName, this.lastName]
      .filter((str) => str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * @returns {string}
   */
  get fullNameByLastName() {
    return [this.lastName, this.firstName]
      .filter((str) => str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

module.exports = User;
