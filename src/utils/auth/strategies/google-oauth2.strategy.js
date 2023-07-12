const passport = require('passport');
const config = require('../../../config');
const { Strategy: GoogleStrategy } = require('passport-google-oauth2');

passport.use(
  new GoogleStrategy(
    {
      clientID: config.oauthGoogle.clientId,
      clientSecret: config.oauthGoogle.clientSecret,
      callbackURL: config.oauthGoogle.oauthRedirect,
      passReqToCallback: true,
    },
    (request, accessToken, refreshToken, profile, done) => {
      
    },
  ),
);
