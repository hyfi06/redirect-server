const CrudService = require('../../../utils/crud.service');
const User = require('../models/user.model');
const config = require('../../../config');
const boom = require('@hapi/boom');
const {
  createUserParser,
  updateUserParser,
  userParser,
} = require('../parsers/user.parser');

class UserServices extends CrudService {
  constructor(membershipService) {
    super(
      config.firestore.collections.users,
      userParser,
      createUserParser,
      updateUserParser,
    );
    this.membershipService = membershipService;
  }

  /**
   * @param {string} email - The user's email address
   * @returns {Promise<User>}
   */
  async getByEmail(email) {
    const query = this.db.collection.where('email', '==', email);
    const userSnap = await query.get();
    if (userSnap.empty) {
      throw boom.notFound('User not found');
    }
    return this.docParser(userSnap.docs[0]);
  }

  /**
   * Deletes a user and removes them from all their groups atomically.
   * @param {string} id
   * @returns {Promise<string>} the deleted document id
   */
  async delete(id) {
    const user = await this.findOne(id);
    await super.delete(id);
    if (this.membershipService) {
      await this.membershipService.removeUserFromAllGroups(id, user.groups);
    }
    return id;
  }

  /**
   * Creates a new user, enforcing email uniqueness.
   * @param {User} user
   * @returns {Promise<User>}
   */
  async create(user) {
    try {
      await this.getByEmail(user.email);
    } catch (error) {
      if (error.output?.statusCode !== 404) throw error;
      const newDoc = await this.db.create(this.createParser(user));
      return this.docParser(newDoc);
    }
    throw boom.badRequest('User already created');
  }
}

module.exports = UserServices;
