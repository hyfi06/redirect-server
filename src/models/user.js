class User {
  /**
   * User model
   * @param {Object} data
   * @param {string} data.email
   * @param {string} data.firstName
   * @param {string} data.lastName
   * @param {FirebaseFirestore.DocumentReference[]} data.groups
   * @param {Date} data.created
   * @param {Date} data.updated
   */
  constructor(data) {
    const { email, firstName, lastName, groups, created, updated } = data;
    this.email = email.toLowerCase().trim();
    this.firstName = firstName?.trim() || '';
    this.lastName = lastName?.trim() || '';
    this.groups = groups || [];
    if (created) this.created = created;
    this.updated = updated || new Date();
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
