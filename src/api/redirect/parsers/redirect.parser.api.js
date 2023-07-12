const FireStore = require('@google-cloud/firestore');
const Redirect = require('../models/redirect.models.api');
const {
  cleanDocObject,
  deleteRegData,
} = require('../../../utils/clean.data.utils');

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
 * Parser Redirect to create doc object
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
 * Parser redirect to update doc object
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
