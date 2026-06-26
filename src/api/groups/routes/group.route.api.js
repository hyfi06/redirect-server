const express = require('express');
const boom = require('@hapi/boom');
const { Filter } = require('@google-cloud/firestore');
const validatorHandler = require('../../../middleware/validator.handler');
const { authenticate } = require('../../../middleware/authenticate.middleware');
const { authorize } = require('../../../middleware/authorize.middleware');
const { requireJwt } = require('../../../middleware/require-jwt.middleware');
const { Group } = require('../models/group.model');
const { groupService } = require('../../../lib/services');
const {
  createGroupSchema,
  updateGroupSchema,
  idParamSchema,
  getGroupQuerySchema,
} = require('../schemas/group.schema');

const groupRouterApi = express.Router();

groupRouterApi.use(authenticate);

// API Keys are scoped to redirects only — group management requires a full JWT session
groupRouterApi.use(requireJwt);

groupRouterApi.get(
  '/',
  validatorHandler(getGroupQuerySchema, 'query'),
  async (req, res, next) => {
    const { orderBy, offset, limit, inactive } = req.query;
    const options = { orderBy, offset: offset ? parseInt(offset) : undefined, limit: limit ? parseInt(limit) : undefined };

    try {
      if (inactive) {
        if (req.user.role !== 'admin') return next(boom.forbidden('Insufficient permissions'));
        const data = await groupService.findInactive(options);
        return res.status(200).json({ message: 'groups retrieved', data });
      }

      if (req.user.role === 'admin') {
        // admin: all active groups
        const data = await groupService.find(['deletedAt', '==', null], options);
        return res.status(200).json({ message: 'groups retrieved', data });
      }

      // user: own active groups only
      if (!Array.isArray(req.user.groups) || req.user.groups.length === 0) {
        return res.status(200).json({ message: 'groups retrieved', data: [] });
      }

      const filter = Filter.and(
        Filter.where('slug', 'in', req.user.groups),
        Filter.where('deletedAt', '==', null),
      );
      const data = await groupService.find([filter], options);
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
  authorize('admin'),
  validatorHandler(idParamSchema, 'params'),
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
  authorize('admin'),
  validatorHandler(idParamSchema, 'params'),
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
