const passport = require('passport');
const config = require('../../../config');
const { Strategy: GoogleStrategy } = require('passport-google-oauth2');
const UserService = require('../../../api/users/services/user.service');
const AuthTokenService = require('../../../api/users/services/auth-token.service');

const userService = new UserService();
const authTokenService = new AuthTokenService();

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
        await authTokenService.write(user.id, {
          googleToken: accessToken,
          googleRefreshToken: refreshToken,
        });
        return done(null, user);
      } catch (error) {
        return done(error);
      }
    },
  ),
);
