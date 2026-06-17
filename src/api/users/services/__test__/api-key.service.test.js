'use strict';

const ApiKey = require('../../models/api-key.model');

// Mock @hapi/boom so we can assert on the thrown errors.
jest.mock('@hapi/boom');
const boom = require('@hapi/boom');

// Mock @google-cloud/firestore to provide Firestore.Timestamp.fromMillis
// and prevent firestore-client.js from attempting a real Firestore connection.
jest.mock('@google-cloud/firestore', () => {
  const mockFirestoreInstance = {};
  const MockFirestore = jest.fn(() => mockFirestoreInstance);
  MockFirestore.Timestamp = {
    fromMillis: jest.fn((ms) => ({ _seconds: Math.floor(ms / 1000), _nanoseconds: 0 })),
  };
  return { Firestore: MockFirestore };
});

// After @google-cloud/firestore is mocked, require firestoreClient — it will
// construct a mock Firestore instance and export it. We then replace its methods.
const firestoreClient = require('../../../../lib/firestore-client');

const ApiKeyService = require('../api-key.service');

// ---------------------------------------------------------------------------
// Helper — build a Firestore DocumentSnapshot stub parseable by apiKeyDocParser
// ---------------------------------------------------------------------------
function makeDocSnap(overrides = {}) {
  const createdMillis = overrides.createdMillis !== undefined ? overrides.createdMillis : 1_700_000_000_000;
  const data = {
    name: overrides.name || 'Test Key',
    keyHash: overrides.keyHash || 'hash-abc',
    prefix: overrides.prefix || 'tst',
    scopes: overrides.scopes || ['read'],
    active: overrides.active !== undefined ? overrides.active : true,
    createdAt: { toMillis: () => createdMillis },
    lastUsedAt: overrides.lastUsedAt !== undefined ? overrides.lastUsedAt : null,
    expiresAt: overrides.expiresAt !== undefined ? overrides.expiresAt : null,
    ...overrides.extraData,
  };
  return {
    ref: {
      id: overrides.id || 'key-123',
      parent: {
        parent: {
          id: overrides.userId || 'user-999',
        },
      },
    },
    exists: overrides.exists !== undefined ? overrides.exists : true,
    data: () => data,
  };
}

// ---------------------------------------------------------------------------
// Mock chain builder
//
// firestoreClient.collection('users')
//   .doc(userId)
//   .collection('apiKeys')
//   .orderBy / .where / .add / .doc
//
// We use a shared set of spies that every chain step returns `this` on,
// then override specific terminal calls (get, add, update) per test.
// ---------------------------------------------------------------------------
let mockApiKeysCol;
let mockUserDoc;
let mockCollectionGroupChain;

function buildChain() {
  // Terminal operations on the apiKeys subcollection
  mockApiKeysCol = {
    orderBy: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: jest.fn(),
    add: jest.fn(),
    doc: jest.fn(),
  };

  // .doc(keyId) inside the subcollection
  const mockKeyDocRef = {
    get: jest.fn(),
    update: jest.fn(),
  };
  mockApiKeysCol.doc.mockReturnValue(mockKeyDocRef);

  // users.doc(userId)
  mockUserDoc = {
    collection: jest.fn().mockReturnValue(mockApiKeysCol),
  };

  // users collection
  const mockUsersCol = {
    doc: jest.fn().mockReturnValue(mockUserDoc),
  };

  // collectionGroup chain
  mockCollectionGroupChain = {
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: jest.fn(),
  };

  firestoreClient.collection = jest.fn().mockReturnValue(mockUsersCol);
  firestoreClient.collectionGroup = jest.fn().mockReturnValue(mockCollectionGroupChain);

  return { mockApiKeysCol, mockKeyDocRef };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe('ApiKeyService', () => {
  let service;
  let mockApiKeysCol;
  let mockKeyDocRef;

  beforeEach(() => {
    // Reset all mock implementations between tests
    jest.clearAllMocks();

    const chain = buildChain();
    mockApiKeysCol = chain.mockApiKeysCol;
    mockKeyDocRef = chain.mockKeyDocRef;

    boom.badRequest.mockReturnValue({
      isBoom: true,
      output: { statusCode: 400, payload: { error: 'Bad Request', message: 'API key limit reached (10)' } },
      message: 'API key limit reached (10)',
    });
    boom.notFound.mockReturnValue({
      isBoom: true,
      output: { statusCode: 404, payload: { error: 'Not Found', message: 'API key not found' } },
      message: 'API key not found',
    });

    service = new ApiKeyService();
  });

  // -------------------------------------------------------------------------
  // list(userId)
  // -------------------------------------------------------------------------
  describe('list(userId)', () => {
    it('queries the correct subcollection path', async () => {
      mockApiKeysCol.get.mockResolvedValue({ empty: true, docs: [] });

      await service.list('user-abc');

      expect(firestoreClient.collection).toHaveBeenCalledWith('users');
      expect(mockUserDoc.collection).toHaveBeenCalledWith('apiKeys');
    });

    it('orders results by createdAt descending', async () => {
      mockApiKeysCol.get.mockResolvedValue({ empty: true, docs: [] });

      await service.list('user-abc');

      expect(mockApiKeysCol.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    });

    it('returns an array of ApiKey instances parsed via apiKeyDocParser', async () => {
      const snap1 = makeDocSnap({ id: 'key-1', name: 'Key One' });
      const snap2 = makeDocSnap({ id: 'key-2', name: 'Key Two' });
      mockApiKeysCol.get.mockResolvedValue({ empty: false, docs: [snap1, snap2] });

      const result = await service.list('user-abc');

      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(ApiKey);
      expect(result[1]).toBeInstanceOf(ApiKey);
      expect(result[0].id).toBe('key-1');
      expect(result[1].id).toBe('key-2');
    });

    it('returns an empty array when there are no documents', async () => {
      mockApiKeysCol.get.mockResolvedValue({ empty: true, docs: [] });

      const result = await service.list('user-abc');

      expect(result).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // create(userId, apiKey)
  // -------------------------------------------------------------------------
  describe('create(userId, apiKey)', () => {
    function makeApiKeyInput(overrides = {}) {
      return new ApiKey({
        name: overrides.name || 'New Key',
        keyHash: overrides.keyHash || 'hash-new',
        prefix: overrides.prefix || 'nwk',
        scopes: overrides.scopes || ['read'],
        expiresAt: null,
      });
    }

    it('throws boom.badRequest when there are already 10 active keys', async () => {
      // First .get() is the active-count check — return size: 10
      mockApiKeysCol.get.mockResolvedValueOnce({ size: 10, empty: false, docs: [] });

      const apiKey = makeApiKeyInput();

      await expect(service.create('user-abc', apiKey)).rejects.toMatchObject({
        isBoom: true,
        output: { statusCode: 400 },
        message: 'API key limit reached (10)',
      });
      expect(boom.badRequest).toHaveBeenCalledWith('API key limit reached (10)');
    });

    it('does not write a document when the limit is reached', async () => {
      mockApiKeysCol.get.mockResolvedValueOnce({ size: 10, empty: false, docs: [] });

      const apiKey = makeApiKeyInput();

      await expect(service.create('user-abc', apiKey)).rejects.toBeTruthy();
      expect(mockApiKeysCol.add).not.toHaveBeenCalled();
    });

    it('writes the document with createdAt Timestamp when fewer than 10 active keys exist', async () => {
      // Active count check → size: 3 (under limit)
      mockApiKeysCol.get.mockResolvedValueOnce({ size: 3, empty: false, docs: [] });

      const createdSnap = makeDocSnap({ id: 'key-new' });
      const mockDocRef = { get: jest.fn().mockResolvedValue(createdSnap) };
      mockApiKeysCol.add.mockResolvedValue(mockDocRef);

      const apiKey = makeApiKeyInput({ keyHash: 'the-hash', prefix: 'prf', name: 'New Key' });

      await service.create('user-abc', apiKey);

      expect(mockApiKeysCol.add).toHaveBeenCalledTimes(1);
      const writtenData = mockApiKeysCol.add.mock.calls[0][0];
      expect(writtenData).toHaveProperty('createdAt');
      expect(writtenData.createdAt).toBeDefined();
    });

    it('returns the created ApiKey parsed from the Firestore response', async () => {
      mockApiKeysCol.get.mockResolvedValueOnce({ size: 0, empty: true, docs: [] });

      const createdSnap = makeDocSnap({ id: 'key-new', name: 'New Key', prefix: 'nwk' });
      const mockDocRef = { get: jest.fn().mockResolvedValue(createdSnap) };
      mockApiKeysCol.add.mockResolvedValue(mockDocRef);

      const apiKey = makeApiKeyInput();
      const result = await service.create('user-abc', apiKey);

      expect(result).toBeInstanceOf(ApiKey);
      expect(result.id).toBe('key-new');
    });

    it('checks active keys using a where filter on the active field', async () => {
      mockApiKeysCol.get.mockResolvedValueOnce({ size: 0, empty: true, docs: [] });

      const createdSnap = makeDocSnap({ id: 'key-new' });
      const mockDocRef = { get: jest.fn().mockResolvedValue(createdSnap) };
      mockApiKeysCol.add.mockResolvedValue(mockDocRef);

      await service.create('user-abc', new ApiKey({ name: 'K', keyHash: 'h', prefix: 'p', scopes: [] }));

      expect(mockApiKeysCol.where).toHaveBeenCalledWith('active', '==', true);
    });
  });

  // -------------------------------------------------------------------------
  // revoke(userId, keyId)
  // -------------------------------------------------------------------------
  describe('revoke(userId, keyId)', () => {
    it('throws boom.notFound when the document does not exist', async () => {
      mockKeyDocRef.get.mockResolvedValue({ exists: false, data: () => ({}) });

      await expect(service.revoke('user-abc', 'key-ghost')).rejects.toMatchObject({
        isBoom: true,
        output: { statusCode: 404 },
        message: 'API key not found',
      });
      expect(boom.notFound).toHaveBeenCalledWith('API key not found');
    });

    it('updates active: false when the document exists', async () => {
      const doc = makeDocSnap({ id: 'key-123', keyHash: 'hash-to-revoke' });
      mockKeyDocRef.get.mockResolvedValue(doc);
      mockKeyDocRef.update.mockResolvedValue(undefined);

      await service.revoke('user-abc', 'key-123');

      expect(mockKeyDocRef.update).toHaveBeenCalledWith({ active: false });
    });

    it('returns the keyHash from the document', async () => {
      const doc = makeDocSnap({ id: 'key-123', keyHash: 'returned-hash' });
      mockKeyDocRef.get.mockResolvedValue(doc);
      mockKeyDocRef.update.mockResolvedValue(undefined);

      const result = await service.revoke('user-abc', 'key-123');

      expect(result).toBe('returned-hash');
    });

    it('calls doc() with the correct keyId on the subcollection', async () => {
      const doc = makeDocSnap({ id: 'key-target', keyHash: 'h' });
      mockKeyDocRef.get.mockResolvedValue(doc);
      mockKeyDocRef.update.mockResolvedValue(undefined);

      await service.revoke('user-abc', 'key-target');

      expect(mockApiKeysCol.doc).toHaveBeenCalledWith('key-target');
    });
  });

  // -------------------------------------------------------------------------
  // findByHash(keyHash)
  // -------------------------------------------------------------------------
  describe('findByHash(keyHash)', () => {
    it('returns null when no results are found', async () => {
      mockCollectionGroupChain.get.mockResolvedValue({ empty: true, docs: [] });

      const result = await service.findByHash('unknown-hash');

      expect(result).toBeNull();
    });

    it('returns { apiKey, userId } when a matching document is found', async () => {
      const docSnap = makeDocSnap({ id: 'key-found', userId: 'user-owner' });
      mockCollectionGroupChain.get.mockResolvedValue({ empty: false, docs: [docSnap] });

      const result = await service.findByHash('hash-abc');

      expect(result).not.toBeNull();
      expect(result.apiKey).toBeInstanceOf(ApiKey);
      expect(result.userId).toBe('user-owner');
    });

    it('extracts userId from docSnap.ref.parent.parent.id', async () => {
      const docSnap = makeDocSnap({ userId: 'user-from-parent' });
      mockCollectionGroupChain.get.mockResolvedValue({ empty: false, docs: [docSnap] });

      const result = await service.findByHash('some-hash');

      expect(result.userId).toBe('user-from-parent');
    });

    it('queries collectionGroup("apiKeys") with the correct hash filter and limit 1', async () => {
      mockCollectionGroupChain.get.mockResolvedValue({ empty: true, docs: [] });

      await service.findByHash('search-hash');

      expect(firestoreClient.collectionGroup).toHaveBeenCalledWith('apiKeys');
      expect(mockCollectionGroupChain.where).toHaveBeenCalledWith('keyHash', '==', 'search-hash');
      expect(mockCollectionGroupChain.limit).toHaveBeenCalledWith(1);
    });
  });
});
