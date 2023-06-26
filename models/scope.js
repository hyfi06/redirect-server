class Scope {
  /**
   * Scope class
   * @param {Object} data
   * @param {string} data.group
   * @param {string[]} data.permissions
   */
  constructor(data) {
    const { group, permissions } = data;
    this.group = group || 'owner';
    this.permissions = permissions || [];
  }
}

const OWNER_SCOPES = new Scope({
  group: 'owner',
  permissions: ['read', 'edit', 'delete'],
});

module.exports = {
  Scope,
  OWNER_SCOPES,
};
