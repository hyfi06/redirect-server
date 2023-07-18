const express = require('express');
const RedirectServiceApi = require('../services/redirect.service.api');
const { Filter } = require('@google-cloud/firestore');
const Redirect = require('../models/redirect.models.api');
const validatorHandler = require('../../../middleware/validator.handler');
const {
  getRedirectQuerySchema,
  getRedirectSchema,
  createRedirectSchema,
  updateRedirectSchema,
  deleteRedirectSchema,
} = require('../schemas/redirect.schema');

const redirectServicieApi = new RedirectServiceApi();
const redirectRouterApi = express.Router();

redirectRouterApi.get(
  '/',
  validatorHandler(getRedirectQuerySchema, 'query'),
  async (req, res, next) => {
    const { owner, group, orderBy, offset, limit } = req.query;

    try {
      const redirectArray = await redirectServicieApi.find(
        [
          Filter.or(
            Filter.where('owner', '==', owner),
            Filter.where('permission', 'array-contains', `read:${group}`),
          ),
        ],
        {
          orderBy: orderBy,
          offset: parseInt(offset),
          limit: parseInt(limit),
        },
      );
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
    const redirect = new Redirect({ ...req.body });
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
    const redirect = new Redirect({ id, ...req.body });
    try {
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
