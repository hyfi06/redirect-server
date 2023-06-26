const PERMISSIONS = {
  all: ['read', 'edit', 'delete'],
  readOnly: ['read'],
  rw: ['read', 'edit'],
};

class Scope {
  /**
   * Scope class
   * @param {Object} data
   * @param {FirebaseFirestore.DocumentReference} data.group
   * @param {string[]} data.permissions
   */
  constructor(data) {
    const { group, permissions } = data;
    this.group = group || 'groups/owner';
    this.permissions = permissions || [];
  }
}

const OWNER_SCOPES = new Scope({
  group: 'groups/owner',
  permissions: PERMISSIONS.all,
});

module.exports = {
  Scope,
  OWNER_SCOPES,
  PERMISSIONS,
};
