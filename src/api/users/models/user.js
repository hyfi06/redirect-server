class User {
  /**
   * User model
   * @param {Object} data
   * @param {string} data.email
   * @param {string} data.firstName
   * @param {string} data.lastName
   * @param {string[]} data.groups
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
    this.email = email.toLowerCase().trim();
    this.firstName = firstName?.trim() || '';
    this.lastName = lastName?.trim() || '';
    this.groups = groups || [];
    this.role = role || 'user';
    this.auth = {
      googleToken,
      googleRefreshToken,
      refreshToken,
      apiToken,
    };
    if (created) this.created = created;
    if (updated) this.updated = updated;
  }

  get fullNameByName() {
    return [this.firstName, this.lastName]
      .filter((str) => str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  get fullNameByLastName() {
    return [this.lastName, this.firstName]
      .filter((str) => str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

module.exports = User;
