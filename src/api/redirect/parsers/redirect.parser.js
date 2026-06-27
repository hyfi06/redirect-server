const FireStore = require('@google-cloud/firestore');
const Redirect = require('../models/redirect.model');
const {
  cleanDocObject,
  deleteRegData,
  parseTimestamp,
} = require('../../../utils/clean.data.utils');

/**
 * Parses a Firestore DocumentSnapshot into a Redirect instance.
 * @param {FireStore.DocumentSnapshot} docSnap
 * @returns {Redirect}
 */
function redirectParser(docSnap) {
  const id = docSnap.ref.id;

  const data = docSnap.data();
  return new Redirect({
    ...data,
    id,
    created: parseTimestamp(data.created),
    updated: parseTimestamp(data.updated),
  });
}

/**
 * Prepares a Redirect for Firestore creation.
 * @param {Redirect} redirect
 * @returns {Object}
 */
function createRedirectParser(redirect) {
  return {
    path: redirect.path.replace(/\/$/, ''),
    url: redirect.url,
    owner: redirect.owner,
    permission: redirect.permission || [],
    categories: redirect.categories || [],
  };
}

/**
 * Prepares a Redirect for Firestore update — strips id, owner, path, created, updated and removes undefined keys.
 * @param {Redirect} redirect
 * @returns {Object}
 */
function updateRedirectParser(redirect) {
  const docData = { ...redirect };
  deleteRegData(docData);
  delete docData.owner;
  // path is immutable post-creation — strip here regardless of schema to prevent
  // privilege escalation and uniqueness bypass if schema changes in the future
  delete docData.path;
  cleanDocObject(docData);
  return docData;
}

module.exports = {
  redirectParser,
  createRedirectParser,
  updateRedirectParser,
};
