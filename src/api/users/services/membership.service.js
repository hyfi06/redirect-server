const Firestore = require('@google-cloud/firestore');
const config = require('../../../config');
const firestoreClient = require('../../../lib/firestore-client');

class MembershipService {
  /**
   * @param {import('./user.service')} userService
   * @param {import('../../groups/services/group.service')} groupService
   */
  constructor(userService, groupService) {
    this.userService = userService;
    this.groupService = groupService;
    this.groupsCollection = config.firestore.collections.groups;
  }

  /**
   * Adds batch operations to remove userId from every group in userGroups.
   * Does NOT commit the batch — caller is responsible for committing.
   * No-op when userGroups is empty or absent.
   * @param {FirebaseFirestore.WriteBatch} batch
   * @param {string} userId
   * @param {string[]} userGroups - array of group slugs the user belongs to
   * @returns {Promise<void>}
   */
  async addOpsToRemoveUserFromGroups(batch, userId, userGroups) {
    if (!userGroups?.length) return;

    const now = Firestore.Timestamp.fromMillis(Date.now());

    for (const slug of userGroups) {
      const group = await this.groupService.getBySlug(slug);
      const groupRef = firestoreClient.collection(this.groupsCollection).doc(group.id);
      batch.update(groupRef, { users: Firestore.FieldValue.arrayRemove(userId), updated: now });
    }
  }

  /**
   * Removes userId from every group in userGroups atomically via a WriteBatch.
   * No-op when userGroups is empty or absent.
   * @param {string} userId
   * @param {string[]} userGroups - array of group slugs the user belongs to
   * @returns {Promise<void>}
   */
  async removeUserFromAllGroups(userId, userGroups) {
    if (!userGroups?.length) return;

    const batch = firestoreClient.batch();
    await this.addOpsToRemoveUserFromGroups(batch, userId, userGroups);
    await batch.commit();
  }

  /**
   * Adds batch operations to sync userId into the groups defined by the slug diff.
   * Slugs added get `FieldValue.arrayUnion`; slugs removed get `FieldValue.arrayRemove`.
   * Does NOT commit the batch — caller is responsible for committing.
   * No-op when both oldSlugs and newSlugs are empty.
   * @param {FirebaseFirestore.WriteBatch} batch
   * @param {string} userId
   * @param {string[]} oldSlugs - slugs the user previously belonged to
   * @param {string[]} newSlugs - slugs the user should belong to after the update
   * @returns {Promise<void>}
   */
  async addOpsToSyncUserGroups(batch, userId, oldSlugs, newSlugs) {
    const oldArr = oldSlugs ?? [];
    const newArr = newSlugs ?? [];
    const addedSlugs = newArr.filter(s => !oldArr.includes(s));
    const removedSlugs = oldArr.filter(s => !newArr.includes(s));

    const now = Firestore.Timestamp.fromMillis(Date.now());

    for (const slug of addedSlugs) {
      const group = await this.groupService.getBySlug(slug);
      const groupRef = firestoreClient.collection(this.groupsCollection).doc(group.id);
      batch.update(groupRef, { users: Firestore.FieldValue.arrayUnion(userId), updated: now });
    }

    for (const slug of removedSlugs) {
      const group = await this.groupService.getBySlug(slug);
      const groupRef = firestoreClient.collection(this.groupsCollection).doc(group.id);
      batch.update(groupRef, { users: Firestore.FieldValue.arrayRemove(userId), updated: now });
    }
  }
}

module.exports = MembershipService;
