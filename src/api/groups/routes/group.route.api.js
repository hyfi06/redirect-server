const express = require('express');
const boom = require('@hapi/boom');
const validatorHandler = require('../../../middleware/validator.handler');
const { authenticate } = require('../../../middleware/authenticate.middleware');
const { authorize } = require('../../../middleware/authorize.middleware');
const { Group } = require('../models/group.model.api');
const GroupService = require('../services/group.service.api');
const UserServices = require('../../users/services/user.service.api');
const {
  createGroupSchema,
  updateGroupSchema,
  idParamSchema,
  getGroupQuerySchema,
} = require('../schemas/group.schema');

const userService = new UserServices();
const groupService = new GroupService(userService);

const groupRouterApi = express.Router();

groupRouterApi.use(authenticate);

groupRouterApi.get(
  '/',
  validatorHandler(getGroupQuerySchema, 'query'),
  async (req, res, next) => {
    const { orderBy, offset, limit } = req.query;
    const options = { orderBy, offset: offset ? parseInt(offset) : undefined, limit: limit ? parseInt(limit) : undefined };

    try {
      if (req.user.role === 'admin') {
        // admin: all groups
        const data = await groupService.getAll(options);
        return res.status(200).json({ message: 'groups retrieved', data });
      }

      // user: own groups only
      if (!Array.isArray(req.user.groups) || req.user.groups.length === 0) {
        return res.status(200).json({ message: 'groups retrieved', data: [] });
      }

      const data = await groupService.find(['slug', 'in', req.user.groups], options);
      return res.status(200).json({ message: 'groups retrieved', data });
    } catch (error) {
      next(error);
    }
  },
);

groupRouterApi.get(
  '/:id',
  validatorHandler(idParamSchema, 'params'),
  async (req, res, next) => {
    const { id } = req.params;
    try {
      const data = await groupService.findOne(id);
      if (req.user.role !== 'admin' && !req.user.groups.includes(data.slug)) {
        return next(boom.forbidden('Insufficient permissions'));
      }
      return res.status(200).json({ message: 'group retrieved', data });
    } catch (error) {
      next(error);
    }
  },
);

groupRouterApi.post(
  '/',
  authorize('admin'),
  validatorHandler(createGroupSchema, 'body'),
  async (req, res, next) => {
    const group = new Group(req.body);
    try {
      const data = await groupService.create(group);
      return res.status(201).json({ message: 'group created', data });
    } catch (error) {
      next(error);
    }
  },
);

groupRouterApi.patch(
  '/:id',
  validatorHandler(idParamSchema, 'params'),
  authorize('admin'),
  async (req, res, next) => {
    // slug is immutable (D14): check here, not in Joi, to return an explicit message
    if (req.body.slug !== undefined) {
      return next(boom.badRequest('slug is immutable'));
    }

    const { error, value } = updateGroupSchema.validate(req.body, { abortEarly: false });
    if (error) return next(boom.badRequest(error));

    const { id } = req.params;
    const group = new Group({ id, ...value });
    try {
      const data = await groupService.update(id, group);
      return res.status(200).json({ message: 'group updated', data });
    } catch (error) {
      next(error);
    }
  },
);

groupRouterApi.delete(
  '/:id',
  validatorHandler(idParamSchema, 'params'),
  authorize('admin'),
  async (req, res, next) => {
    const { id } = req.params;
    try {
      const data = await groupService.delete(id);
      return res.status(200).json({ message: 'group deleted', data });
    } catch (error) {
      next(error);
    }
  },
);

module.exports = { groupRouterApi };
