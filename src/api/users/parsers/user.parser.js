const FireStore = require('@google-cloud/firestore');
const User = require('../models/user.model');
const {
  cleanDocObject,
  deleteRegData,
  parseTimestamp,
  parseOptionalTimestamp,
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
    created: parseTimestamp(data.created),
    updated: parseTimestamp(data.updated),
    deletedAt: parseOptionalTimestamp(data.deletedAt),
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
    deletedAt: null,
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
  delete data.deletedAt; // immutable via API — managed only by delete()
  cleanDocObject(data);
  return data;
}

module.exports = { userParser, createUserParser, updateUserParser };
