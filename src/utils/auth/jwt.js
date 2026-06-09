const jwt = require('jsonwebtoken');
const config = require('../../config');

/**
  * @description Sign a payload and return a JWT token
  * @param {Object} payload - The payload to sign
  * @returns {String} The signed JWT token
  */
function sign(payload) {
  return jwt.sign(payload, config.jwt.jwtSecret, { expiresIn: config.jwt.jwtTtl });
}


/**
  * @description Verifies a JWT and returns the decoded payload.
  * @param {String} token - The JWT token to verify
  * @returns {Object} The decoded payload
  */
function verify(token) {
  return jwt.verify(token, config.jwt.jwtSecret);
}

module.exports = { sign, verify };
