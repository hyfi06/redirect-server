const Joi = require('joi');

const id = Joi.string();
const email = Joi.string().email();
const name = Joi.string().max(70).min(1);
const groups = Joi.array().items(Joi.string());
const token = Joi.string();
const role = Joi.string();
const date = Joi.date();
const auth = Joi.object({
  googleToken: token,
  googleRefreshToken: token,
  refreshToken: token,
  apiToken: token,
});

const createUserSchema = Joi.object({
  email: email.required(),
  firstName: name,
  lastName: name,
  groups: groups,
  role: role.required(),
  auth: auth,
});

const idSchema = Joi.object({
  id: id.required(),
});

module.exports = {
  idSchema,
  createUserSchema,
};
