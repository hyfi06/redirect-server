const Firestore = require('@google-cloud/firestore');
const boom = require('@hapi/boom');
const CrudService = require('../../../utils/crud.service');
const config = require('../../../config');
const firestoreClient = require('../../../lib/firestore-client');
const { groupDocParser, createGroupParser, updateGroupParser } = require('../parsers/group.parser');

class GroupService extends CrudService {
  /**
   * @param {import('../../users/services/user.service')} userService
   * Depends on UserServices for membership sync. If UserServices ever needs GroupService,
   * extract the sync logic to a MembershipService.
   */
  constructor(userService) {
    super(config.firestore.collections.groups, groupDocParser, createGroupParser, updateGroupParser);
    this.userService = userService;
    this.groupsCollection = config.firestore.collections.groups;
    this.usersCollection = config.firestore.collections.users;
  }

  /**
   * @param {string} slug
   * @returns {Promise<Group>}
   */
  async getBySlug(slug) {
    const query = this.db.collection.where('slug', '==', slug);
    const snapshot = await query.get();
    if (snapshot.empty) throw boom.notFound('Group not found');
    return this.docParser(snapshot.docs[0]);
  }

  /**
   * @param {import('../models/group.model')} group
   * @returns {Promise<import('../models/group.model')>}
   */
  async create(group) {
    try {
      await this.getBySlug(group.slug);
    } catch (e) {
      if (e.output?.statusCode !== 404) throw e;
      return this.docParser(await this.db.create(this.createParser(group)));
    }
    throw boom.badRequest('Slug already taken');
  }

  /**
   * Updates the group and atomically syncs User.groups for added/removed members
   * using a Firestore WriteBatch. Fetch-first: all users in the diff are fetched
   * before any write. If any user does not exist, the request fails with 400 and
   * nothing is written.
   *
   * Timestamp must be set manually on every batch entry — WriteBatch bypasses
   * FireStoreAdapter, so auto-timestamping does not apply.
   *
   * The post-commit get() is required to return the updated document: batch.commit()
   * returns void and does not provide the updated field values.
   * @param {string} id
   * @param {import('../models/group.model')} group
   * @returns {Promise<import('../models/group.model')>}
   * @throws {import('@hapi/boom').Boom} 400 if any user in the membership diff does not exist
   */
  async update(id, group) {
    const batch = firestoreClient.batch();
    const now = Firestore.Timestamp.fromMillis(Date.now());

    if (group.users !== undefined) {
      const current = await this.findOne(id);
      const oldUsers = current.users || [];
      const newUsers = group.users;

      const added = newUsers.filter((email) => !oldUsers.includes(email));
      const removed = oldUsers.filter((email) => !newUsers.includes(email));
      const diffEmails = [...added, ...removed];

      // Fetch-first: verify all users in the diff exist before writing anything
      const userMap = new Map();
      for (const email of diffEmails) {
        try {
          const user = await this.userService.getByEmail(email);
          userMap.set(email, user);
        } catch (e) {
          if (e.output?.statusCode === 404) {
            throw boom.badRequest(`User not found: ${email}`);
          }
          throw e;
        }
      }

      // Queue batch updates for added members
      for (const email of added) {
        const user = userMap.get(email);
        const userRef = firestoreClient.collection(this.usersCollection).doc(user.id);
        batch.update(userRef, { groups: [...user.groups, current.slug], updated: now });
      }

      // Queue batch updates for removed members
      for (const email of removed) {
        const user = userMap.get(email);
        const userRef = firestoreClient.collection(this.usersCollection).doc(user.id);
        batch.update(userRef, { groups: user.groups.filter((g) => g !== current.slug), updated: now });
      }
    }

    // Include the group document itself in the batch
    const groupRef = firestoreClient.collection(this.groupsCollection).doc(id);
    batch.update(groupRef, { ...updateGroupParser(group), updated: now });

    await batch.commit();

    const updatedSnap = await groupRef.get();
    return this.docParser(updatedSnap);
  }
}

module.exports = GroupService;
