const express = require('express');
const boom = require('@hapi/boom');
const validatorHandler = require('../../../middleware/validator.handler');
const { authenticate } = require('../../../middleware/authenticate.middleware');
const { authorize } = require('../../../middleware/authorize.middleware');
const User = require('../models/user');
const UserService = require('../services/user.service.api');
const {
  idSchema,
  getUsersQuerySchema,
  createUserSchema,
  selectUpdateSchema,
} = require('../schemas/user.schema');

const userService = new UserService();

const userRouterApi = express.Router();

// All user routes require a valid JWT
userRouterApi.use(authenticate);

// GET /me must be declared before GET /:id so Express does not treat "me" as an id param (D-B4-4)
userRouterApi.get('/me', async (req, res, next) => {
  try {
    const user = await userService.findOne(req.user.userId);
    res.status(200).json({ message: 'profile retrieved', data: user.toPublic() });
  } catch (error) {
    next(error);
  }
});

// D16: list exposes emails, roles, and group membership — no legitimate use case for regular users in v3
userRouterApi.get(
  '/',
  authorize('admin'),
  validatorHandler(getUsersQuerySchema, 'query'),
  async (req, res, next) => {
    const { offset, limit } = req.query;
    try {
      const data = await userService.find(null, {
        offset: parseInt(offset),
        limit: parseInt(limit),
      });
      res.status(200).json({
        message: 'users retrieved',
        data: data.map((u) => u.toPublic()),
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
      res.status(200).json({ message: 'user retrieved', data: data.toPublic() });
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
      res.status(201).json({ message: 'user created', data: data.toPublic() });
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
      res.status(200).json({ message: 'user updated', data: data.toPublic() });
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
