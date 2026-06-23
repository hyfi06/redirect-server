class User {
  /**
   * User model
   * @param {Object} data
   * @param {string} data.email
   * @param {string} data.firstName
   * @param {string} data.lastName
   * @param {string[]} [data.groups] — undefined when omitted; omitted fields are stripped by cleanDocObject on PATCH (D20)
   * @param {string} data.role
   * @param {string} data.googleToken
   * @param {string} data.googleRefreshToken
   * @param {string} data.refreshToken
   * @param {string} data.apiToken
   * @param {Date} data.created
   * @param {Date} data.updated
   */
  constructor(data) {
    const {
      id,
      email,
      firstName,
      lastName,
      groups,
      role,
      googleToken,
      googleRefreshToken,
      refreshToken,
      apiToken,
      created,
      updated,
    } = data;
    this.id = id || null;
    this.email = email ? email.toLowerCase().trim() : undefined;
    this.firstName = firstName?.trim() || '';
    this.lastName = lastName?.trim() || '';
    // No default — groups: undefined in a PATCH body must remain undefined so cleanDocObject omits it (D20)
    this.groups = groups;
    // No default — role: undefined in a PATCH body must remain undefined so cleanDocObject omits it (D20)
    this.role = role;
    this.auth = {
      googleToken: googleToken,
      googleRefreshToken,
      refreshToken,
      apiToken,
    };
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
  /**
   * Returns a plain object safe for JSON responses (no auth tokens).
   * @returns {Object}
   */
  toPublic() {
    return {
      id: this.id,
      email: this.email,
      firstName: this.firstName,
      lastName: this.lastName,
      groups: this.groups,
      role: this.role,
      created: this.created,
      updated: this.updated,
    };
  }
}

module.exports = User;
