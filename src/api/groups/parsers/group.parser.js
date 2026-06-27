const FireStore = require('@google-cloud/firestore');
const { Group } = require('../models/group.model');
const { cleanDocObject, deleteRegData, parseTimestamp, parseOptionalTimestamp } = require('../../../utils/clean.data.utils');

/**
 * @param {FireStore.DocumentSnapshot} docSnap
 * @returns {Group}
 */
function groupDocParser(docSnap) {
  const id = docSnap.ref.id;
  const data = docSnap.data();
  return new Group({
    ...data,
    id,
    created: parseTimestamp(data.created),
    updated: parseTimestamp(data.updated),
    deletedAt: parseOptionalTimestamp(data.deletedAt),
  });
}

/**
 * @param {Group} group
 * @returns {Object}
 */
function createGroupParser(group) {
  return {
    name: group.name,
    slug: group.slug,
    // Default [] on create: a new group always has an explicit users array in Firestore.
    // Distinct from the model, which preserves undefined so cleanDocObject skips the field in PATCH.
    users: group.users !== undefined ? group.users : [],
    deletedAt: null,
  };
}

/**
 * @param {Group} group
 * @returns {Object}
 */
function updateGroupParser(group) {
  const data = { ...group };
  deleteRegData(data);
  delete data.slug;      // immutable after creation (D14)
  delete data.deletedAt; // immutable via API — managed only by delete()
  cleanDocObject(data);
  return data;
}

module.exports = { groupDocParser, createGroupParser, updateGroupParser };
