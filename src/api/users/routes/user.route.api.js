const express = require('express');
const boom = require('@hapi/boom');
const validatorHandler = require('../../../middleware/validator.handler');
const { authenticate } = require('../../../middleware/authenticate.middleware');
const { authorize } = require('../../../middleware/authorize.middleware');
const User = require('../models/user.model');
const UserService = require('../services/user.service');
const GroupService = require('../../groups/services/group.service');
const MembershipService = require('../services/membership.service');
const { apiKeyRouter } = require('./api-key.route');
const {
  idSchema,
  getUsersQuerySchema,
  createUserSchema,
  selectUpdateSchema,
} = require('../schemas/user.schema');

// userServiceForGroup is a bare instance passed to GroupService for its fetch-first membership
// checks in update(). It must not carry a membershipService to avoid a circular dependency.
const userServiceForGroup = new UserService();
const groupService = new GroupService(userServiceForGroup);
const membershipService = new MembershipService(userServiceForGroup, groupService);
const userService = new UserService(membershipService);

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

const userRouterApi = express.Router();

// All user routes require a valid JWT
userRouterApi.use(authenticate);

// API Keys are scoped to redirects only — user management requires a full JWT session
userRouterApi.use((req, res, next) => {
  if (req.user.apiKey !== undefined) return next(boom.forbidden('API Keys cannot be used on this resource'));
  next();
});

// GET /me must be declared before GET /:id so Express does not treat "me" as an id param (D-B4-4)
userRouterApi.get('/me', async (req, res, next) => {
  try {
    const user = await userService.findOne(req.user.userId);
    res.status(200).json({ message: 'profile retrieved', data: toPublic(user) });
  } catch (error) {
    next(error);
  }
});

// /me/api-keys must be mounted before /:id so Express does not treat "me" as an id param
userRouterApi.use('/me/api-keys', apiKeyRouter);

// D16: list exposes emails, roles, and group membership — no legitimate use case for regular users in v3
userRouterApi.get(
  '/',
  authorize('admin'),
  validatorHandler(getUsersQuerySchema, 'query'),
  async (req, res, next) => {
    const { offset, limit, inactive } = req.query;
    const options = {
      offset: offset ? parseInt(offset) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    };
    try {
      if (inactive) {
        const data = await userService.findInactive(options);
        return res.status(200).json({
          message: 'users retrieved',
          data: data.map((u) => toPublic(u)),
        });
      }

      const data = await userService.find(['deletedAt', '==', null], options);
      res.status(200).json({
        message: 'users retrieved',
        data: data.map((u) => toPublic(u)),
      });
    } catch (error) {
      next(error);
    }
  },
);

// D17: regular users access their own profile via GET /me; /:id is admin-only
userRouterApi.get(
  '/:id',
  authorize('admin'),
  validatorHandler(idSchema, 'params'),
  async (req, res, next) => {
    const { id } = req.params;
    try {
      const data = await userService.findOne(id);
      res.status(200).json({ message: 'user retrieved', data: toPublic(data) });
    } catch (error) {
      next(error);
    }
  },
);

userRouterApi.post(
  '/',
  authorize('admin'),
  validatorHandler(createUserSchema, 'body'),
  async (req, res, next) => {
    const user = new User(req.body);
    try {
      const data = await userService.create(user);
      res.status(201).json({ message: 'user created', data: toPublic(data) });
    } catch (error) {
      next(error);
    }
  },
);

userRouterApi.patch(
  '/:id',
  validatorHandler(idSchema, 'params'),
  async (req, res, next) => {
    const { id } = req.params;
    const isAdmin = req.user.role === 'admin';

    // Admins may edit any user; regular users may only edit their own profile (D-B4-2, D17)
    if (!isAdmin && req.user.userId !== id) {
      return next(boom.forbidden('Cannot update another user'));
    }

    // Admin can change role and groups; regular users can only change their own name (D-B4-3)
    const schema = selectUpdateSchema(req.user.role);
    const { error, value } = schema.validate(req.body, { abortEarly: false, allowUnknown: false });
    if (error) return next(boom.badRequest(error.message));

    const user = new User({ id, ...value });
    try {
      const data = await userService.update(user);
      res.status(200).json({ message: 'user updated', data: toPublic(data) });
    } catch (error) {
      next(error);
    }
  },
);

userRouterApi.delete(
  '/:id',
  authorize('admin'),
  validatorHandler(idSchema, 'params'),
  async (req, res, next) => {
    const { id } = req.params;
    try {
      const data = await userService.delete(id);
      res.status(200).json({ message: 'user deleted', data });
    } catch (error) {
      next(error);
    }
  },
);

module.exports = { userRouterApi };
