const Joi = require('joi');
const common = require('../../schemas/common.schema');

const email = Joi.string().email();
const name = Joi.string().max(70).min(1);
// max(10) guards the array-contains-any Firestore limit of 10 values
const groups = Joi.array().items(Joi.string()).max(10);
const role = Joi.string().valid('user', 'admin');

const getUsersQuerySchema = Joi.object({
  offset: common.offset,
  limit: common.limit,
  inactive: common.inactive,
});

const createUserSchema = Joi.object({
  email: email.required(),
  firstName: name,
  lastName: name,
  groups: groups,
  role: role,
});

const idSchema = Joi.object({
  id: common.id.required(),
});

// Admin can change role and groups; regular users can only change their own name (D-B4-3)
const updateUserByAdminSchema = Joi.object({
  firstName: name,
  lastName: name,
  groups: groups,
  role: Joi.string().valid('user', 'admin'),
});

const updateUserSelfSchema = Joi.object({
  firstName: name,
  lastName: name,
});

/**
 * Returns the appropriate update schema based on the requesting user's role.
 * @param {string} role
 * @returns {import('joi').ObjectSchema}
 */
function selectUpdateSchema(role) {
  return role === 'admin' ? updateUserByAdminSchema : updateUserSelfSchema;
}

module.exports = {
  idSchema,
  getUsersQuerySchema,
  createUserSchema,
  updateUserByAdminSchema,
  updateUserSelfSchema,
  selectUpdateSchema,
};
