'use strict';

const UserServices = require('../user.service');
const User = require('../../models/user.model');

jest.mock('../../../../lib/firestore');
const FireStoreAdapter = require('../../../../lib/firestore');

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
describe('UserServices', () => {
  let service;
  let mockDb;

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
    service = new UserServices();
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
  // delete (inherited from CrudService)
  // -------------------------------------------------------------------------
  describe('delete', () => {
    it('returns the deleted document id when the document exists', async () => {
      mockDb.delete.mockResolvedValue('user-del');

      const result = await service.delete('user-del');

      expect(result).toBe('user-del');
      expect(mockDb.delete).toHaveBeenCalledWith('user-del');
    });

    it('propagates boom.notFound when the document does not exist', async () => {
      mockDb.delete.mockRejectedValue({
        isBoom: true,
        output: { statusCode: 404 },
        message: 'Resource not found',
      });

      await expect(service.delete('ghost')).rejects.toMatchObject({
        isBoom: true,
        output: { statusCode: 404 },
        message: 'Resource not found',
      });
    });
  });
});
