'use strict';

const UserService = require('../user.service');
const User = require('../../models/user.model');

jest.mock('../../../../lib/firestore');
const FireStoreAdapter = require('../../../../lib/firestore');

// firestoreClient singleton is imported directly by user.service.js to create
// WriteBatch instances for atomic deletes. Mock it so batch() is controllable.
jest.mock('../../../../lib/firestore-client');
const firestoreClient = require('../../../../lib/firestore-client');

// Use real boom — errors are verified by message / isBoom shape, matching the
// pattern established in src/lib/__test__/firestore.test.js.

// ---------------------------------------------------------------------------
// Helper — build a realistic DocumentSnapshot stub that userParser can parse
// ---------------------------------------------------------------------------
function makeDocSnap(overrides = {}) {
  const data = {
    email: overrides.email || 'test@example.com',
    firstName: overrides.firstName || 'Test',
    lastName: overrides.lastName || 'User',
    groups: overrides.groups || [],
    role: overrides.role || 'user',
    auth: overrides.auth || {},
    created: { toMillis: () => 1_000_000 },
    updated: { toMillis: () => 2_000_000 },
  };
  return {
    ref: { id: overrides.id || 'user-123' },
    data: () => data,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe('UserService', () => {
  let service;
  let mockDb;
  let mockBatch;

  beforeEach(() => {
    mockDb = {
      get: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      collection: {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn(),
      },
    };
    FireStoreAdapter.mockImplementation(() => mockDb);

    // Batch mock for atomic delete path (firestoreClient.batch())
    mockBatch = {
      delete: jest.fn(),
      update: jest.fn(),
      commit: jest.fn().mockResolvedValue(undefined),
    };
    firestoreClient.batch = jest.fn().mockReturnValue(mockBatch);
    firestoreClient.collection = jest.fn().mockReturnValue({
      doc: jest.fn().mockReturnValue({}),
    });

    service = new UserService();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // getByEmail
  // -------------------------------------------------------------------------
  describe('getByEmail', () => {
    it('returns a User instance with the correct id and email when the email exists', async () => {
      const snap = makeDocSnap({ id: 'user-abc', email: 'found@example.com' });
      mockDb.collection.get.mockResolvedValue({ empty: false, docs: [snap] });

      const result = await service.getByEmail('found@example.com');

      expect(result).toBeInstanceOf(User);
      expect(result.id).toBe('user-abc');
      expect(result.email).toBe('found@example.com');
    });

    it('throws boom.notFound when no user has that email', async () => {
      mockDb.collection.get.mockResolvedValue({ empty: true, docs: [] });

      await expect(service.getByEmail('missing@example.com')).rejects.toMatchObject({
        isBoom: true,
        output: { statusCode: 404 },
        message: 'User not found',
      });
    });

    it('queries Firestore using an equality filter on the email field', async () => {
      const snap = makeDocSnap({ email: 'q@example.com' });
      mockDb.collection.get.mockResolvedValue({ empty: false, docs: [snap] });

      await service.getByEmail('q@example.com');

      expect(mockDb.collection.where).toHaveBeenCalledWith('email', '==', 'q@example.com');
    });

    it('queries Firestore with where("deletedAt", "==", null) — only active users are returned', async () => {
      const snap = makeDocSnap({ email: 'q@example.com' });
      mockDb.collection.get.mockResolvedValue({ empty: false, docs: [snap] });

      await service.getByEmail('q@example.com');

      expect(mockDb.collection.where).toHaveBeenCalledWith('deletedAt', '==', null);
    });
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------
  describe('create', () => {
    it('creates a new user document and returns a User instance when the email does not exist yet', async () => {
      // getByEmail → notFound (email is free)
      mockDb.collection.get.mockResolvedValue({ empty: true, docs: [] });

      const createdSnap = makeDocSnap({ id: 'new-user', email: 'new@example.com' });
      mockDb.create.mockResolvedValue(createdSnap);

      const input = new User({ email: 'new@example.com', firstName: 'New', lastName: 'User' });
      const result = await service.create(input);

      expect(result).toBeInstanceOf(User);
      expect(result.id).toBe('new-user');
      expect(result.email).toBe('new@example.com');
      expect(mockDb.create).toHaveBeenCalledTimes(1);
    });

    it('throws boom.badRequest when a user with that email already exists', async () => {
      // getByEmail → resolves (email is taken)
      const existingSnap = makeDocSnap({ email: 'taken@example.com' });
      mockDb.collection.get.mockResolvedValue({ empty: false, docs: [existingSnap] });

      const input = new User({ email: 'taken@example.com', firstName: 'Dup', lastName: 'User' });

      await expect(service.create(input)).rejects.toMatchObject({
        isBoom: true,
        output: { statusCode: 400 },
        message: 'User already created',
      });

      expect(mockDb.create).not.toHaveBeenCalled();
    });

    it('propagates non-404 errors from getByEmail without calling db.create', async () => {
      // Simulate a Firestore / network error surfaced as a Boom 503
      const serviceUnavailableError = {
        isBoom: true,
        output: { statusCode: 503 },
        message: 'Service Unavailable',
      };
      mockDb.collection.get.mockRejectedValue(serviceUnavailableError);

      const input = new User({ email: 'any@example.com', firstName: 'Any', lastName: 'User' });

      await expect(service.create(input)).rejects.toMatchObject({
        isBoom: true,
        output: { statusCode: 503 },
        message: 'Service Unavailable',
      });

      expect(mockDb.create).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // findOne (inherited from CrudService)
  // -------------------------------------------------------------------------
  describe('findOne', () => {
    it('returns a User instance when the document exists', async () => {
      const snap = makeDocSnap({ id: 'user-xyz', email: 'one@example.com' });
      mockDb.get.mockResolvedValue(snap);

      const result = await service.findOne('user-xyz');

      expect(result).toBeInstanceOf(User);
      expect(result.id).toBe('user-xyz');
      expect(result.email).toBe('one@example.com');
      expect(mockDb.get).toHaveBeenCalledWith('user-xyz');
    });

    it('propagates boom.notFound when the document does not exist', async () => {
      mockDb.get.mockRejectedValue({
        isBoom: true,
        output: { statusCode: 404 },
        message: 'Resource not found',
      });

      await expect(service.findOne('ghost')).rejects.toMatchObject({
        isBoom: true,
        output: { statusCode: 404 },
        message: 'Resource not found',
      });
    });
  });

  // -------------------------------------------------------------------------
  // find (inherited from CrudService)
  // -------------------------------------------------------------------------
  describe('find', () => {
    it('returns an array of User instances matching the query', async () => {
      const snap1 = makeDocSnap({ id: 'u1', email: 'a@example.com' });
      const snap2 = makeDocSnap({ id: 'u2', email: 'b@example.com' });
      mockDb.collection.get.mockResolvedValue({ empty: false, docs: [snap1, snap2] });

      const result = await service.find(['role', '==', 'user'], {});

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(User);
      expect(result[1]).toBeInstanceOf(User);
      expect(result[0].id).toBe('u1');
      expect(result[1].id).toBe('u2');
    });

    it('returns an empty array when no documents match', async () => {
      mockDb.collection.get.mockResolvedValue({ empty: true, docs: [] });

      const result = await service.find(['role', '==', 'admin'], {});

      expect(result).toEqual([]);
    });

    it('applies orderBy, offset, and limit options to the query', async () => {
      mockDb.collection.get.mockResolvedValue({ empty: true, docs: [] });

      await service.find(null, { orderBy: 'email', offset: 5, limit: 10 });

      expect(mockDb.collection.orderBy).toHaveBeenCalledWith('email', 'asc');
      expect(mockDb.collection.offset).toHaveBeenCalledWith(5);
      expect(mockDb.collection.limit).toHaveBeenCalledWith(10);
    });

    it('applies descending order when orderBy is prefixed with "-"', async () => {
      mockDb.collection.get.mockResolvedValue({ empty: true, docs: [] });

      await service.find(null, { orderBy: '-email' });

      expect(mockDb.collection.orderBy).toHaveBeenCalledWith('email', 'desc');
    });
  });

  // -------------------------------------------------------------------------
  // update (inherited from CrudService)
  // -------------------------------------------------------------------------
  describe('update', () => {
    it('returns the updated User when the document exists', async () => {
      const updatedSnap = makeDocSnap({ id: 'user-upd', email: 'upd@example.com', firstName: 'Updated' });
      mockDb.update.mockResolvedValue(updatedSnap);

      const input = new User({
        id: 'user-upd',
        email: 'upd@example.com',
        firstName: 'Updated',
        lastName: 'Person',
      });
      const result = await service.update(input);

      expect(result).toBeInstanceOf(User);
      expect(result.id).toBe('user-upd');
      expect(result.firstName).toBe('Updated');
      expect(mockDb.update).toHaveBeenCalledWith('user-upd', expect.any(Object));
    });

    it('propagates boom.notFound when the document does not exist', async () => {
      mockDb.update.mockRejectedValue({
        isBoom: true,
        output: { statusCode: 404 },
        message: 'Resource not found',
      });

      const input = new User({ id: 'ghost', email: 'ghost@example.com' });

      await expect(service.update(input)).rejects.toMatchObject({
        isBoom: true,
        output: { statusCode: 404 },
        message: 'Resource not found',
      });
    });

    it('strips id and immutable fields before writing via updateUserParser', async () => {
      const updatedSnap = makeDocSnap({ id: 'u1', email: 'strip@example.com' });
      mockDb.update.mockResolvedValue(updatedSnap);

      const input = new User({
        id: 'u1',
        email: 'strip@example.com',
        firstName: 'Strip',
        lastName: 'Test',
      });
      await service.update(input);

      const [, writtenData] = mockDb.update.mock.calls[0];
      // id and email must be stripped by updateUserParser
      expect(writtenData).not.toHaveProperty('id');
      expect(writtenData).not.toHaveProperty('email');
    });
  });

  // -------------------------------------------------------------------------
  // delete — overrides CrudService: fetch-first, then delete, then group sync
  // -------------------------------------------------------------------------
  describe('delete', () => {
    it('soft-deletes the user when the document exists and user has no groups', async () => {
      mockDb.get.mockResolvedValue(makeDocSnap({ id: 'user-del', groups: [] }));

      const result = await service.delete('user-del');

      expect(result).toBe('user-del');
      expect(mockDb.get).toHaveBeenCalledWith('user-del');
      // Soft-delete: batch.update — no hard batch.delete or adapter delete
      expect(mockDb.delete).not.toHaveBeenCalled();
      expect(firestoreClient.batch).toHaveBeenCalledTimes(1);
      expect(mockBatch.update).toHaveBeenCalledTimes(1);
      const [, payload] = mockBatch.update.mock.calls[0];
      expect(payload.deletedAt).toBeDefined();
      expect(payload.updated).toBeDefined();
      expect(mockBatch.commit).toHaveBeenCalledTimes(1);
    });

    it('propagates boom.notFound when the document does not exist', async () => {
      const notFound = Object.assign(new Error('Resource not found'), {
        isBoom: true,
        output: { statusCode: 404 },
      });
      mockDb.get.mockRejectedValue(notFound);

      await expect(service.delete('ghost')).rejects.toMatchObject({
        isBoom: true,
        output: { statusCode: 404 },
        message: 'Resource not found',
      });
      expect(mockDb.delete).not.toHaveBeenCalled();
    });

    // Soft-delete path — no membershipService
    it('soft-deletes without cascade when no membershipService is provided, even if user has groups', async () => {
      // service from outer beforeEach has no membershipService
      mockDb.get.mockResolvedValue(makeDocSnap({ id: 'user-1', groups: ['fc'] }));

      const result = await service.delete('user-1');

      expect(result).toBe('user-1');
      // Soft-delete always goes through the batch path
      expect(mockDb.delete).not.toHaveBeenCalled();
      expect(firestoreClient.batch).toHaveBeenCalledTimes(1);
      expect(mockBatch.update).toHaveBeenCalledTimes(1);
      expect(mockBatch.commit).toHaveBeenCalledTimes(1);
    });

    // Soft-delete path — no groups to cascade
    it('soft-deletes without cascade when membershipService is present but user has no groups', async () => {
      const mockMembershipService = { addOpsToRemoveUserFromGroups: jest.fn() };
      const serviceWithMembership = new UserService(mockMembershipService);

      mockDb.get.mockResolvedValue(makeDocSnap({ id: 'user-1', groups: [] }));

      const result = await serviceWithMembership.delete('user-1');

      expect(result).toBe('user-1');
      expect(mockDb.delete).not.toHaveBeenCalled();
      expect(firestoreClient.batch).toHaveBeenCalledTimes(1);
      expect(mockBatch.commit).toHaveBeenCalledTimes(1);
      // No group cascade needed — user has no groups
      expect(mockMembershipService.addOpsToRemoveUserFromGroups).not.toHaveBeenCalled();
    });

    // [B2] Atomicidad — happy path
    it('[B2] calls addOpsToRemoveUserFromGroups with the batch and user groups, then commits once', async () => {
      const mockMembershipService = {
        addOpsToRemoveUserFromGroups: jest.fn().mockResolvedValue(undefined),
      };
      const serviceWithMembership = new UserService(mockMembershipService);

      mockDb.get.mockResolvedValue(makeDocSnap({ id: 'user-1', groups: ['fc', 'cs'] }));

      const result = await serviceWithMembership.delete('user-1');

      expect(result).toBe('user-1');

      // The atomic path must NOT call super.delete (mockDb.delete)
      expect(mockDb.delete).not.toHaveBeenCalled();

      // A single batch is created
      expect(firestoreClient.batch).toHaveBeenCalledTimes(1);

      // addOpsToRemoveUserFromGroups receives the batch as first arg, plus id and groups
      expect(mockMembershipService.addOpsToRemoveUserFromGroups).toHaveBeenCalledTimes(1);
      expect(mockMembershipService.addOpsToRemoveUserFromGroups).toHaveBeenCalledWith(
        mockBatch,
        'user-1',
        ['fc', 'cs'],
      );

      // batch.commit() is called exactly once
      expect(mockBatch.commit).toHaveBeenCalledTimes(1);
    });

    // [B2] Atomicidad — error before commit
    it('[B2] does not call batch.commit() when addOpsToRemoveUserFromGroups throws', async () => {
      const groupError = new Error('Group lookup failed');
      const mockMembershipService = {
        addOpsToRemoveUserFromGroups: jest.fn().mockRejectedValue(groupError),
      };
      const serviceWithMembership = new UserService(mockMembershipService);

      mockDb.get.mockResolvedValue(makeDocSnap({ id: 'user-1', groups: ['fc'] }));

      await expect(serviceWithMembership.delete('user-1')).rejects.toThrow('Group lookup failed');

      // commit must not have been called — the user document was not deleted
      expect(mockBatch.commit).not.toHaveBeenCalled();
      // super.delete must not have been called either
      expect(mockDb.delete).not.toHaveBeenCalled();
    });

    it('does not call batch.commit() or addOpsToRemoveUserFromGroups when findOne throws 404', async () => {
      const mockMembershipService = { addOpsToRemoveUserFromGroups: jest.fn() };
      const serviceWithMembership = new UserService(mockMembershipService);

      const notFound = Object.assign(new Error('Resource not found'), {
        isBoom: true,
        output: { statusCode: 404 },
      });
      mockDb.get.mockRejectedValue(notFound);

      await expect(serviceWithMembership.delete('nonexistent')).rejects.toMatchObject({
        isBoom: true,
        output: { statusCode: 404 },
      });

      expect(mockDb.delete).not.toHaveBeenCalled();
      expect(mockMembershipService.addOpsToRemoveUserFromGroups).not.toHaveBeenCalled();
      expect(mockBatch.commit).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // update — override: batch path when groups field is present
  // -------------------------------------------------------------------------
  describe('update — batch path', () => {
    it('delegates to super.update() when user.groups is undefined', async () => {
      const updatedSnap = makeDocSnap({ id: 'u1' });
      mockDb.update.mockResolvedValue(updatedSnap);

      // No groups in the input — constructor sets this.groups = undefined
      const input = new User({ id: 'u1', firstName: 'Test' });
      expect(input.groups).toBeUndefined();

      await service.update(input);

      // super.update() uses db.update() — batch is not used
      expect(mockDb.update).toHaveBeenCalledTimes(1);
      expect(firestoreClient.batch).not.toHaveBeenCalled();
    });

    it('delegates to super.update() when user.groups is defined but membershipService is absent', async () => {
      const updatedSnap = makeDocSnap({ id: 'u1', groups: ['fc'] });
      mockDb.update.mockResolvedValue(updatedSnap);

      // service from outer beforeEach has no membershipService
      const input = new User({ id: 'u1', groups: ['fc'] });

      await service.update(input);

      expect(mockDb.update).toHaveBeenCalledTimes(1);
      expect(firestoreClient.batch).not.toHaveBeenCalled();
    });

    it('uses a WriteBatch when user.groups is defined and membershipService is present', async () => {
      const mockMembershipService = {
        addOpsToSyncUserGroups: jest.fn().mockResolvedValue(undefined),
      };
      const serviceWithMembership = new UserService(mockMembershipService);

      const oldSnap = makeDocSnap({ id: 'u1', groups: ['old-group'] });
      mockDb.get.mockResolvedValue(oldSnap);

      const input = new User({ id: 'u1', groups: ['new-group'] });
      await serviceWithMembership.update(input);

      // super.update() (mockDb.update) is NOT called in the batch path
      expect(mockDb.update).not.toHaveBeenCalled();
      // A single WriteBatch is created
      expect(firestoreClient.batch).toHaveBeenCalledTimes(1);
      // batch.update writes the user document
      expect(mockBatch.update).toHaveBeenCalledTimes(1);
      // membershipService.addOpsToSyncUserGroups receives (batch, userId, oldGroups, newGroups)
      expect(mockMembershipService.addOpsToSyncUserGroups).toHaveBeenCalledWith(
        mockBatch,
        'u1',
        ['old-group'],
        ['new-group'],
      );
      // batch is committed once after all ops are queued
      expect(mockBatch.commit).toHaveBeenCalledTimes(1);
    });

    it('passes oldUser.groups ?? [] when the old document has no groups field', async () => {
      const mockMembershipService = {
        addOpsToSyncUserGroups: jest.fn().mockResolvedValue(undefined),
      };
      const serviceWithMembership = new UserService(mockMembershipService);

      // Snap with no groups field in data — userParser sets groups: undefined; ?? [] → []
      const oldSnap = {
        ref: { id: 'u1' },
        data: () => ({
          email: 'test@example.com',
          firstName: 'Test',
          lastName: 'User',
          role: 'user',
          created: { toMillis: () => 1_000_000 },
          updated: { toMillis: () => 2_000_000 },
          // groups intentionally absent
        }),
      };
      mockDb.get.mockResolvedValue(oldSnap);

      const input = new User({ id: 'u1', groups: ['fc'] });
      await serviceWithMembership.update(input);

      expect(mockMembershipService.addOpsToSyncUserGroups).toHaveBeenCalledWith(
        mockBatch,
        'u1',
        [], // oldUser.groups ?? [] resolves to []
        ['fc'],
      );
    });

    it('returns the updated user from findOne after batch.commit()', async () => {
      const mockMembershipService = {
        addOpsToSyncUserGroups: jest.fn().mockResolvedValue(undefined),
      };
      const serviceWithMembership = new UserService(mockMembershipService);

      const snap = makeDocSnap({ id: 'u1', groups: ['fc'] });
      mockDb.get.mockResolvedValue(snap);

      const input = new User({ id: 'u1', groups: ['fc'] });
      const result = await serviceWithMembership.update(input);

      expect(result).toBeInstanceOf(User);
      expect(result.id).toBe('u1');
    });

    it('does not call batch.commit() when addOpsToSyncUserGroups throws', async () => {
      const syncError = new Error('Group sync failed');
      const mockMembershipService = {
        addOpsToSyncUserGroups: jest.fn().mockRejectedValue(syncError),
      };
      const serviceWithMembership = new UserService(mockMembershipService);

      const snap = makeDocSnap({ id: 'u1', groups: ['old'] });
      mockDb.get.mockResolvedValue(snap);

      const input = new User({ id: 'u1', groups: ['new'] });
      await expect(serviceWithMembership.update(input)).rejects.toThrow('Group sync failed');

      expect(mockBatch.commit).not.toHaveBeenCalled();
    });
  });
});
