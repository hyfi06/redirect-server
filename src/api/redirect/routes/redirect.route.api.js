const express = require('express');
const boom = require('@hapi/boom');
const { Filter } = require('@google-cloud/firestore');
const Redirect = require('../models/redirect.model');
const validatorHandler = require('../../../middleware/validator.handler');
const { authenticate } = require('../../../middleware/authenticate.middleware');
const { authorizeApiKeyScope } = require('../../../middleware/authorize-api-key-scope.middleware');
const { redirectServiceApi, groupService } = require('../../../lib/services');
const {
  getRedirectQuerySchema,
  getRedirectSchema,
  createRedirectSchema,
  updateRedirectSchema,
  deleteRedirectSchema,
} = require('../schemas/redirect.schema');
const redirectRouterApi = express.Router();

// All redirect routes require a valid JWT — owner and group membership are derived
// from req.user; they are never trusted from the request body or query string.
redirectRouterApi.use(authenticate);

redirectRouterApi.get(
  '/',
  authorizeApiKeyScope('read:redirects'),
  validatorHandler(getRedirectQuerySchema, 'query'),
  async (req, res, next) => {
    const { orderBy, offset, limit } = req.query;
    const { userId, groups } = req.user;
    const options = { orderBy, offset: offset ? parseInt(offset) : undefined, limit: limit ? parseInt(limit) : undefined };

    if (req.user.role === 'admin') {
      try {
        const redirectArray = await redirectServiceApi.getAll(options);
        return res.status(200).json({ message: 'redirects retrieved', data: redirectArray });
      } catch (error) {
        return next(error);
      }
    }

    const readPermissions = groups.map(g => `read:${g}`);
    const filter =
      readPermissions.length > 0
        ? Filter.or(
            Filter.where('owner', '==', userId),
            Filter.where('permission', 'array-contains-any', readPermissions),
          )
        : Filter.where('owner', '==', userId);

    try {
      const redirectArray = await redirectServiceApi.find([filter], options);
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
  authorizeApiKeyScope('read:redirects'),
  validatorHandler(getRedirectSchema, 'params'),
  async (req, res, next) => {
    const { id } = req.params;
    try {
      const data = await redirectServiceApi.findOne(id);
      // Access check mirrors the filter used in GET / but applied to a single doc.
      // Inline following the same pattern as PATCH and DELETE (D3).
      const readPermissions = req.user.groups.map(g => `read:${g}`);
      const canRead =
        req.user.role === 'admin' ||
        data.owner === req.user.userId ||
        (data.permission || []).some(p => readPermissions.includes(p));
      if (!canRead) return next(boom.forbidden('Insufficient permissions'));
      res.status(200).json({ message: 'redirect retrieved', data });
    } catch (error) {
      next(error);
    }
  },
);

redirectRouterApi.post(
  '/',
  authorizeApiKeyScope('write:redirects'),
  validatorHandler(createRedirectSchema, 'body'),
  async (req, res, next) => {
    const { group, path, url, permission, categories } = req.body;

    // Namespace validation must live here, not in Joi — role and group membership
    // come from req.user (the verified JWT), not from the request body (D6).
    if (req.user.role !== 'admin') {
      if (!group) return next(boom.forbidden('group is required for non-admin users'));
      if (!req.user.groups.includes(group))
        return next(boom.forbidden('User does not belong to this group'));
      // Verify the group still exists in Firestore — the JWT may reflect a group
      // that was deleted after the user last authenticated. Checked before getByPath
      // so we fail fast on a nonexistent group before paying the uniqueness-check cost.
      // Admin users bypass this: they can create root-level paths with no group (D-§2-2).
      try {
        await groupService.getBySlug(group);
      } catch (error) {
        return next(error);
      }
    }

    // Leading "/" is required: the catch-all redirect handler uses req.path which
    // Express always delivers with a leading slash, so stored paths must match that form.
    const fullPath = group ? `/${group}/${path}` : `/${path}`;
    const redirect = new Redirect({ path: fullPath, url, permission, categories, owner: req.user.userId });

    try {
      const data = await redirectServiceApi.create(redirect);
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
  authorizeApiKeyScope('write:redirects'),
  validatorHandler(getRedirectSchema, 'params'),
  validatorHandler(updateRedirectSchema, 'body'),
  async (req, res, next) => {
    const { id } = req.params;
    try {
      // Fetch first: owner and permission come from the stored document, never from
      // the request body — the body cannot be trusted to assert its own access rights.
      const existing = await redirectServiceApi.findOne(id);
      const editPermissions = req.user.groups.map(g => `edit:${g}`);
      const canEdit =
        req.user.role === 'admin' ||
        existing.owner === req.user.userId ||
        (existing.permission || []).some(p => editPermissions.includes(p));
      if (!canEdit) return next(boom.forbidden('Insufficient permissions'));
      const redirect = new Redirect({ id, ...req.body });
      const doc = await redirectServiceApi.update(redirect);
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
  authorizeApiKeyScope('write:redirects'),
  validatorHandler(deleteRedirectSchema, 'params'),
  async (req, res, next) => {
    const { id } = req.params;
    try {
      // Fetch first: same reason as PATCH — access check requires the stored owner
      // and permission fields, which cannot be supplied by the requester.
      const existing = await redirectServiceApi.findOne(id);
      const deletePermissions = req.user.groups.map(g => `delete:${g}`);
      const canDelete =
        req.user.role === 'admin' ||
        existing.owner === req.user.userId ||
        (existing.permission || []).some(p => deletePermissions.includes(p));
      if (!canDelete) return next(boom.forbidden('Insufficient permissions'));
      const deletedId = await redirectServiceApi.delete(id);
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
