const boom = require('@hapi/boom');
const CrudService = require('../../../utils/crud.service');
const config = require('../../../config');
const User = require('../../users/models/user');
const { groupDocParser, createGroupParser, updateGroupParser } = require('../parsers/group.parser.api');

class GroupService extends CrudService {
  /**
   * @param {import('../../users/services/user.service.api')} userService
   * Depends on UserServices for membership sync. If UserServices ever needs GroupService,
   * extract the sync logic to a MembershipService.
   */
  constructor(userService) {
    super(config.firestore.collections.groups, groupDocParser, createGroupParser, updateGroupParser);
    this.userService = userService;
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
   * @param {import('../models/group.model.api')} group
   * @returns {Promise<import('../models/group.model.api')>}
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
   * Updates the group and syncs User.groups for added/removed members.
   * Fetch-first: all users in the diff are fetched before any write.
   * If any user does not exist, the request fails with 400 and nothing is written.
   * @param {string} id
   * @param {import('../models/group.model.api')} group
   * @returns {Promise<import('../models/group.model.api')>}
   */
  async update(id, group) {
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

      // Sync User.groups for added members
      for (const email of added) {
        const user = userMap.get(email);
        try {
          await this.userService.update(new User({ ...user, groups: [...user.groups, current.slug] }));
        } catch (e) {
          console.error(`Failed to add group ${current.slug} to user ${email}:`, e);
          throw e;
        }
      }

      // Sync User.groups for removed members
      for (const email of removed) {
        const user = userMap.get(email);
        try {
          await this.userService.update(new User({ ...user, groups: user.groups.filter((g) => g !== current.slug) }));
        } catch (e) {
          console.error(`Failed to remove group ${current.slug} from user ${email}:`, e);
          throw e;
        }
      }
    }

    return super.update(group);
  }
}

module.exports = GroupService;
