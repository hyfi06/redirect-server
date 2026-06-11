const Joi = require('joi');

const id = Joi.string();
const email = Joi.string().email();
const name = Joi.string().max(70).min(1);
// max(10) guards the array-contains-any Firestore limit of 10 values
const groups = Joi.array().items(Joi.string()).max(10);
const token = Joi.string();
const role = Joi.string();
const date = Joi.date();
const auth = Joi.object({
  googleToken: token,
  googleRefreshToken: token,
  refreshToken: token,
  apiToken: token,
});

const getUsersQuerySchema = Joi.object({
  offset: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1),
});

const createUserSchema = Joi.object({
  email: email.required(),
  firstName: name,
  lastName: name,
  groups: groups,
  role: role,
  auth: auth,
});

const idSchema = Joi.object({
  id: id.required(),
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
