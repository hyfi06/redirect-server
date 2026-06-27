const passport = require('passport');
const config = require('../../../config');
const { Strategy: GoogleStrategy } = require('passport-google-oauth2');
const { userService } = require('../../../lib/services');

passport.use(
  new GoogleStrategy(
    {
      clientID: config.oauthGoogle.clientId,
      clientSecret: config.oauthGoogle.clientSecret,
      callbackURL: config.oauthGoogle.oauthRedirect,
      // passReqToCallback: true shifts the callback signature — first arg is req, not accessToken
      passReqToCallback: true,
    },
    async (request, accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails[0].value;
        let user;
        try {
          user = await userService.getByEmail(email);
        } catch (error) {
          if (error.output?.statusCode === 404) {
            return done(null, false, { message: 'User not registered' });
          }
          throw error;
        }
        return done(null, user);
      } catch (error) {
        return done(error);
      }
    },
  ),
);
