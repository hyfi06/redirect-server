const FireStore = require('@google-cloud/firestore');
const Redirect = require('../models/redirect.models.api');
const {
  cleanDocObject,
  deleteRegData,
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
    created: new Date(data.created.toMillis()),
    updated: new Date(data.updated.toMillis()),
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
 * Prepares a Redirect for Firestore update — strips id, owner, created, updated and removes undefined keys.
 * @param {Redirect} redirect
 * @returns {Object}
 */
function updateRedirectParser(redirect) {
  const docData = { ...redirect };
  deleteRegData(docData);
  delete docData.owner;
  cleanDocObject(docData);
  return docData;
}

module.exports = {
  redirectParser,
  createRedirectParser,
  updateRedirectParser,
};
