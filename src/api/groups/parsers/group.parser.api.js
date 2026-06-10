const FireStore = require('@google-cloud/firestore');
const { Group } = require('../models/group.model.api');
const { cleanDocObject, deleteRegData } = require('../../../utils/clean.data.utils');

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
    created: new Date(data.created.toMillis()),
    updated: new Date(data.updated.toMillis()),
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
  };
}

/**
 * @param {Group} group
 * @returns {Object}
 */
function updateGroupParser(group) {
  const data = { ...group };
  deleteRegData(data);
  delete data.slug; // slug is immutable after creation (D14); strip before write
  cleanDocObject(data);
  return data;
}

module.exports = { groupDocParser, createGroupParser, updateGroupParser };
