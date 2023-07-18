const express = require('express');
const validatorHandler = require('../../../middleware/validator.handler');
const User = require('../models/user');
const UserService = require('../services/user.service.api');
const {
  idSchema,
  createUserSchema,
  updateUserSchema,
} = require('../schemas/user.schema');

const userService = new UserService();

const userRouterApi = express.Router();

userRouterApi.get('/', async (req, res, next) => {
  const { offset, limit } = req.query;
  try {
    const data = await userService.find(null, { offset, limit });
    res.status(200).json({
      message: 'users retrieved',
      data,
    });
  } catch (error) {
    next(error);
  }
});

userRouterApi.get(
  '/:id',
  validatorHandler(idSchema, 'params'),
  async (req, res, next) => {
    const { id } = req.params;
    try {
      const data = await userService.findOne(id);
      res.status(200).json({
        message: 'user retrieved',
        data,
      });
    } catch (error) {
      next(error);
    }
  },
);

userRouterApi.post(
  '/',
  validatorHandler(createUserSchema, 'body'),
  async (req, res, next) => {
    const user = new User(req.body);
    try {
      const data = await userService.create(user);
      res.status(201).json({
        message: 'user created',
        data,
      });
    } catch (error) {
      next(error);
    }
  },
);

userRouterApi.patch(
  '/:id',
  validatorHandler(idSchema, 'params'),
  validatorHandler(updateUserSchema, 'body'),
  async (req, res, next) => {
    const { id } = req.params;
    const user = new User({
      id,
      ...req.body,
    });
    try {
      const data = await userService.update(user);
      res.status(200).json({
        message: 'user updated',
        data,
      });
    } catch (error) {
      next(error);
    }
  },
);

userRouterApi.delete(
  '/:id',
  validatorHandler(idSchema, 'params'),
  async (req, res, next) => {
    const { id } = req.params;
    try {
      const data = await userService.delete(id);
      res.status(200).json({
        message: 'user deleted',
        data,
      });
    } catch (error) {
      next(error);
    }
  },
);

module.exports = {userRouterApi};
