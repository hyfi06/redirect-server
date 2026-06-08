const express = require('express');
const boom = require('@hapi/boom');
const RedirectServiceApi = require('../services/redirect.service.api');
const { Filter } = require('@google-cloud/firestore');
const Redirect = require('../models/redirect.models.api');
const validatorHandler = require('../../../middleware/validator.handler');
const { authenticate } = require('../../../middleware/authenticate.middleware');
const {
  getRedirectQuerySchema,
  getRedirectSchema,
  createRedirectSchema,
  updateRedirectSchema,
  deleteRedirectSchema,
} = require('../schemas/redirect.schema');

const redirectServicieApi = new RedirectServiceApi();
const redirectRouterApi = express.Router();

redirectRouterApi.use(authenticate);

redirectRouterApi.get(
  '/',
  validatorHandler(getRedirectQuerySchema, 'query'),
  async (req, res, next) => {
    const { orderBy, offset, limit } = req.query;
    const { email, groups } = req.user;

    const readPermissions = groups.map(g => `read:${g}`);
    const filter =
      readPermissions.length > 0
        ? Filter.or(
            Filter.where('owner', '==', email),
            Filter.where('permission', 'array-contains-any', readPermissions),
          )
        : Filter.where('owner', '==', email);

    try {
      const redirectArray = await redirectServicieApi.find([filter], {
        orderBy,
        offset: parseInt(offset),
        limit: parseInt(limit),
      });
      res.status(200).json({
        message: 'redirects retrieved',
        data: redirectArray,
      });
    } catch (error) {
      next(error);
    }
  },
);

redirectRouterApi.get(
  '/:id',
  validatorHandler(getRedirectSchema, 'params'),
  async (req, res, next) => {
    const { id } = req.params;
    try {
      const data = await redirectServicieApi.findOne(id);
      res.status(200).json({
        message: 'redirect retrieved',
        data,
      });
    } catch (error) {
      next(error);
    }
  },
);

redirectRouterApi.post(
  '/',
  validatorHandler(createRedirectSchema, 'body'),
  async (req, res, next) => {
    const { group, path, url, permission, categories } = req.body;

    if (req.user.role !== 'admin') {
      if (!group) return next(boom.forbidden('group is required for non-admin users'));
      if (!req.user.groups.includes(group))
        return next(boom.forbidden('User does not belong to this group'));
    }

    const fullPath = group ? `/${group}/${path}` : `/${path}`;
    const redirect = new Redirect({ path: fullPath, url, permission, categories, owner: req.user.email });

    try {
      const data = await redirectServicieApi.create(redirect);
      res.status(201).json({
        message: 'redirect created',
        data,
      });
    } catch (error) {
      next(error);
    }
  },
);

redirectRouterApi.patch(
  '/:id',
  validatorHandler(getRedirectSchema, 'params'),
  validatorHandler(updateRedirectSchema, 'body'),
  async (req, res, next) => {
    const { id } = req.params;
    try {
      const existing = await redirectServicieApi.findOne(id);
      if (req.user.role !== 'admin' && existing.owner !== req.user.email) {
        return next(boom.forbidden('Only the owner or an admin can modify this redirect'));
      }
      const redirect = new Redirect({ id, ...req.body });
      const doc = await redirectServicieApi.update(redirect);
      res.status(200).json({
        message: 'redirect updated',
        data: doc,
      });
    } catch (error) {
      next(error);
    }
  },
);

redirectRouterApi.delete(
  '/:id',
  validatorHandler(deleteRedirectSchema, 'params'),
  async (req, res, next) => {
    const { id } = req.params;
    try {
      const existing = await redirectServicieApi.findOne(id);
      if (req.user.role !== 'admin' && existing.owner !== req.user.email) {
        return next(boom.forbidden('Only the owner or an admin can modify this redirect'));
      }
      const deletedId = await redirectServicieApi.delete(id);
      res.status(200).json({
        message: 'redirect deleted',
        data: deletedId,
      });
    } catch (error) {
      next(error);
    }
  },
);

module.exports = { redirectRouterApi };
