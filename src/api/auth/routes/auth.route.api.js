const express = require('express');
const passport = require('passport');
const boom = require('@hapi/boom');
const { sign } = require('../../../utils/auth/jwt');
const { toPublic } = require('../../users/utils/user-public');

require('../../../utils/auth/strategies/google-oauth2.strategy');

const authRouterApi = express.Router();

authRouterApi.get(
  '/google',
  passport.authenticate('google', { scope: ['profile', 'email'] }),
);

authRouterApi.get(
  '/google/callback',
  // session: false — JWT is stateless; failureRedirect: false — we return JSON 401, not a redirect (D4)
  passport.authenticate('google', { failureRedirect: false, session: false }),
  (req, res, next) => {
    if (!req.user) {
      return next(boom.unauthorized('User not registered'));
    }
    const token = sign({ userId: req.user.id, email: req.user.email, role: req.user.role, groups: req.user.groups });
    res.status(200).json({
      message: 'login successful',
      data: {
        token,
        user: toPublic(req.user),
      },
    });
  },
);

module.exports = { authRouterApi };
