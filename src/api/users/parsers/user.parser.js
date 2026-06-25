const FireStore = require('@google-cloud/firestore');
const User = require('../models/user.model');
const {
  cleanDocObject,
  deleteRegData,
} = require('../../../utils/clean.data.utils');

/**
 * Parses a Firestore DocumentSnapshot into a User instance.
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
 * Prepares a User for Firestore creation.
 * @param {User} user
 * @returns {Object}
 */
function createUserParser(user) {
  return {
    email: user.email,
    // Defaults live here, not in the constructor — D20: constructors never default optional fields
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    groups: user.groups || [],
    role: user.role || 'user',
  };
}

/**
 * Prepares a User for Firestore update — strips id, created, updated, email and removes undefined keys.
 * @param {User} user
 * @returns {Object}
 */
function updateUserParser(user) {
  const data = { ...user };
  deleteRegData(data);
  delete data.email;
  cleanDocObject(data);
  return data;
}

module.exports = { userParser, createUserParser, updateUserParser };
