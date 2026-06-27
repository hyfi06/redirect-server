/**
 * @param {import('../models/user.model')} user
 * @returns {Object}
 */
function toPublic(user) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    groups: user.groups,
    role: user.role,
    deletedAt: user.deletedAt,
    created: user.created,
    updated: user.updated,
  };
}

module.exports = { toPublic };
