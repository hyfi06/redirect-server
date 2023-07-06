const FireStore = require('@google-cloud/firestore');
const Redirect = require('../models/redirect.model');

/**
 * Parser DocumentSnapshot to Redirect
 * @param {FireStore.DocumentSnapshot} docSnap
 * @returns {Redirect}
 */
function redirectParser(docSnap) {
  const id = docSnap.ref.id;

  const data = docSnap.data();
  return new Redirect({
    ...data,
    id,
    created: new Date(data.created.toMillis()),
    updated: new Date(data.updated.toMillis()),
  });
}

/**
 *
 * @param {Redirect} redirect
 * @returns {Object}
 */
function createRedirectParser(redirect) {
  return {
    path: redirect.path,
    url: redirect.url,
    owner: redirect.owner,
    permission: redirect.permission || [],
    categories: redirect.categories || [],
  };
}

module.exports = {
  redirectParser,
  createRedirectParser,
};
