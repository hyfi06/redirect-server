const FireStore = require('@google-cloud/firestore');
const User = require('../models/user');
const {
  cleanDocObject,
  deleteRegData,
} = require('../../../utils/clean.data.utils');

/**
 * Parser Document Snapshot to User model
 * @param {FireStore.DocumentSnapshot} docSnap
 * @returns {User}
 */
function userParser(docSnap) {
  const id = docSnap.ref.id;
  const data = docSnap.data();
  return new User({
    ...data,
    id,
    created: new Date(data.created.toMillis()),
    updated: new Date(data.updated.toMillis()),
  });
}

/**
 *Parser User to create doc object
 * @param {User} user
 * @returns {Object}
 */
function createUserParser(user) {
  return {
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    groups: user.groups,
    role: user.role,
    auth: cleanDocObject(user.auth),
  };
}

/**
 * Parser User to update doc object
 * @param {User} user
 * @returns {Object}
 */
function updateUserParser(user) {
  const data = { ...user };
  deleteRegData(data);
  delete data.email;
  if (data.auth) {
    cleanDocObject(data.auth);
    if (Object.keys(data.auth).length === 0) {
      delete data.auth;
    }
  }
  cleanDocObject(data);
  return data;
}

module.exports = { userParser, createUserParser, updateUserParser };
