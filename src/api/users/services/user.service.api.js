const CrudService = require('../../../utils/crud.service');
const User = require('../models/user');
const config = require('../../../config');
const boom = require('@hapi/boom');
const {
  createUserParser,
  updateUserParser,
  userParser,
} = require('../parsers/user.parser.api');

class UserServices extends CrudService {
  constructor() {
    super(
      config.firestore.collections.users,
      userParser,
      createUserParser,
      updateUserParser,
    );
  }

  /**
   *
   * @param {String} email
   * @returns {User}
   */
  async getByEmail(email) {
    const query = await this.db.collection.where('email', '==', email);
    const userSnap = await query.get();
    if (userSnap.empty) {
      throw boom.notFound('User not found');
    }
    return userSnap.docs[0];
  }

  /**
   * @param {User} user
   * @param {User}
   */
  async create(user) {
    try {
      await this.getByEmail(user.email);
    } catch (error) {
      const newDoc = await this.db.create(this.createParser(user));
      return this.docParser(newDoc);
    }
    throw boom.badRequest('User already created');
  }
}

module.exports = UserServices;
