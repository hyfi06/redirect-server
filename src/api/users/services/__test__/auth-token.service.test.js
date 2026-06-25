'use strict';

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

const AuthTokenService = require('../auth-token.service');

// ---------------------------------------------------------------------------
// Mock chain builder
//
// firestoreClient.collection('users')
//   .doc(userId)
//   .collection('auth')
//   .doc('google')
//   → mockGoogleDocRef { get, set }
// ---------------------------------------------------------------------------
let mockGoogleDocRef;

function buildChain() {
  mockGoogleDocRef = {
    get: jest.fn(),
    set: jest.fn(),
  };

  const mockAuthCol = {
    doc: jest.fn().mockReturnValue(mockGoogleDocRef),
  };

  const mockUserDoc = {
    collection: jest.fn().mockReturnValue(mockAuthCol),
  };

  const mockUsersCol = {
    doc: jest.fn().mockReturnValue(mockUserDoc),
  };

  firestoreClient.collection = jest.fn().mockReturnValue(mockUsersCol);

  return { mockGoogleDocRef, mockAuthCol, mockUserDoc, mockUsersCol };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe('AuthTokenService', () => {
  let service;
  let chain;

  beforeEach(() => {
    jest.clearAllMocks();
    chain = buildChain();
    service = new AuthTokenService();
  });

  // -------------------------------------------------------------------------
  // read(userId)
  // -------------------------------------------------------------------------
  describe('read(userId)', () => {
    it('returns document data when the document exists', async () => {
      const tokenData = { accessToken: 'access-abc', refreshToken: 'refresh-xyz' };
      mockGoogleDocRef.get.mockResolvedValue({ exists: true, data: () => tokenData });

      const result = await service.read('user-123');

      expect(result).toEqual(tokenData);
    });

    it('returns null when the document does not exist', async () => {
      mockGoogleDocRef.get.mockResolvedValue({ exists: false, data: () => ({}) });

      const result = await service.read('user-123');

      expect(result).toBeNull();
    });

    it('reads from the correct Firestore path users/{userId}/auth/google', async () => {
      mockGoogleDocRef.get.mockResolvedValue({ exists: false, data: () => ({}) });

      await service.read('user-456');

      expect(firestoreClient.collection).toHaveBeenCalledWith('users');
      expect(chain.mockUsersCol.doc).toHaveBeenCalledWith('user-456');
      expect(chain.mockUserDoc.collection).toHaveBeenCalledWith('auth');
      expect(chain.mockAuthCol.doc).toHaveBeenCalledWith('google');
    });

    it('propagates errors thrown by Firestore get()', async () => {
      const fsError = new Error('Firestore unavailable');
      mockGoogleDocRef.get.mockRejectedValue(fsError);

      await expect(service.read('user-123')).rejects.toThrow('Firestore unavailable');
    });
  });

  // -------------------------------------------------------------------------
  // write(userId, tokens)
  // -------------------------------------------------------------------------
  describe('write(userId, tokens)', () => {
    it('calls set on the correct Firestore path users/{userId}/auth/google', async () => {
      mockGoogleDocRef.set.mockResolvedValue(undefined);

      await service.write('user-789', { accessToken: 'tok' });

      expect(firestoreClient.collection).toHaveBeenCalledWith('users');
      expect(chain.mockUsersCol.doc).toHaveBeenCalledWith('user-789');
      expect(chain.mockUserDoc.collection).toHaveBeenCalledWith('auth');
      expect(chain.mockAuthCol.doc).toHaveBeenCalledWith('google');
      expect(mockGoogleDocRef.set).toHaveBeenCalledTimes(1);
    });

    it('calls set with { merge: true }', async () => {
      mockGoogleDocRef.set.mockResolvedValue(undefined);

      await service.write('user-123', { accessToken: 'tok' });

      const [, options] = mockGoogleDocRef.set.mock.calls[0];
      expect(options).toEqual({ merge: true });
    });

    it('includes the provided tokens in the written payload', async () => {
      mockGoogleDocRef.set.mockResolvedValue(undefined);
      const tokens = { accessToken: 'access-token', refreshToken: 'refresh-token', expiresIn: 3600 };

      await service.write('user-123', tokens);

      const [payload] = mockGoogleDocRef.set.mock.calls[0];
      expect(payload).toMatchObject(tokens);
    });

    it('includes updatedAt in the written payload', async () => {
      mockGoogleDocRef.set.mockResolvedValue(undefined);

      await service.write('user-123', { accessToken: 'tok' });

      const [payload] = mockGoogleDocRef.set.mock.calls[0];
      expect(payload).toHaveProperty('updatedAt');
      expect(payload.updatedAt).toBeDefined();
    });

    it('does not mutate the tokens object passed by the caller', async () => {
      mockGoogleDocRef.set.mockResolvedValue(undefined);
      const tokens = { accessToken: 'tok' };
      const tokensBefore = { ...tokens };

      await service.write('user-123', tokens);

      expect(tokens).toEqual(tokensBefore);
    });

    it('propagates errors thrown by Firestore set()', async () => {
      const fsError = new Error('Write failed');
      mockGoogleDocRef.set.mockRejectedValue(fsError);

      await expect(service.write('user-123', { accessToken: 'tok' })).rejects.toThrow('Write failed');
    });
  });
});
