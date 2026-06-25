const Firestore = require('@google-cloud/firestore');
const CrudService = require('../../../utils/crud.service');
const User = require('../models/user.model');
const config = require('../../../config');
const boom = require('@hapi/boom');
const firestoreClient = require('../../../lib/firestore-client');
const {
  createUserParser,
  updateUserParser,
  userParser,
} = require('../parsers/user.parser');

class UserService extends CrudService {
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
   * @param {string} email
   * @returns {Promise<User>}
   */
  async getByEmail(email) {
    const userSnap = await this.db.collection
      .where('email', '==', email)
      .where('deletedAt', '==', null)
      .get();
    if (userSnap.empty) throw boom.notFound('User not found');
    return this.docParser(userSnap.docs[0]);
  }

  /**
   * Soft-deletes a user and removes them from all their groups in a single atomic batch.
   * Sets deletedAt instead of deleting the document — the user's redirects remain intact.
   * @param {string} id
   * @returns {Promise<string>} the soft-deleted document id
   * @throws {import('@hapi/boom').Boom} 404 if the user does not exist
   */
  async delete(id) {
    const user = await this.findOne(id);
    const batch = firestoreClient.batch();
    const now = Firestore.Timestamp.fromMillis(Date.now());
    const userRef = firestoreClient.collection(config.firestore.collections.users).doc(id);

    batch.update(userRef, { deletedAt: now, updated: now });

    if (this.membershipService && user.groups?.length) {
      await this.membershipService.addOpsToRemoveUserFromGroups(batch, id, user.groups);
    }

    await batch.commit();
    return id;
  }

  /**
   * Updates a user. When the groups field is present and membershipService is available,
   * syncs group membership atomically in a WriteBatch instead of delegating to super.update().
   * @param {User} user
   * @returns {Promise<User>}
   */
  async update(user) {
    if (user.groups === undefined || !this.membershipService) {
      return super.update(user);
    }

    const oldUser = await this.findOne(user.id);
    const batch = firestoreClient.batch();
    const now = Firestore.Timestamp.fromMillis(Date.now());
    const userRef = firestoreClient.collection(config.firestore.collections.users).doc(user.id);

    batch.update(userRef, { ...updateUserParser(user), updated: now });
    await this.membershipService.addOpsToSyncUserGroups(batch, user.id, oldUser.groups ?? [], user.groups);
    await batch.commit();

    return this.findOne(user.id);
  }

  /**
   * Returns all soft-deleted users, ordered by deletedAt descending.
   * Firestore requires ordering by the inequality field first.
   * @param {object} [options]
   * @param {number} [options.offset]
   * @param {number} [options.limit]
   * @returns {Promise<User[]>}
   */
  async findInactive(options = {}) {
    const { offset, limit } = options;
    let fsQuery = this.db.collection
      .where('deletedAt', '!=', null)
      .orderBy('deletedAt', 'desc');
    if (offset) fsQuery = fsQuery.offset(offset);
    if (limit) fsQuery = fsQuery.limit(limit);
    const snap = await fsQuery.get();
    if (snap.empty) return [];
    return snap.docs.map(doc => this.docParser(doc));
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

module.exports = UserService;
