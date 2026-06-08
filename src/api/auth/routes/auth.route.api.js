const express = require('express');
const passport = require('passport');
const boom = require('@hapi/boom');
const { sign } = require('../../../utils/auth/jwt');

require('../../../utils/auth/strategies/google-oauth2.strategy');

const authRouterApi = express.Router();

authRouterApi.get(
  '/google',
  passport.authenticate('google', { scope: ['profile', 'email'] }),
);

authRouterApi.get(
  '/google/callback',
  passport.authenticate('google', { failureRedirect: false, session: false }),
  (req, res, next) => {
    if (!req.user) {
      return next(boom.unauthorized('User not registered'));
    }
    const { id, email, role, groups } = req.user;
    const token = sign({ userId: id, email, role, groups });
    res.status(200).json({
      message: 'login successful',
      data: {
        token,
        user: req.user.toPublic(),
      },
    });
  },
);

module.exports = { authRouterApi };
