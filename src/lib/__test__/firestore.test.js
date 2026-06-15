const Firestore = require('@google-cloud/firestore');
const FireStoreAdapter = require('../firestore');

jest.mock('@google-cloud/firestore');
jest.mock('../../lib/firestore-client', () => ({
  collection: jest.fn(),
}));

const firestoreClient = require('../../lib/firestore-client');

describe('FireStoreAdapter', () => {
  let firestoreAdapter;
  const mockCollection = {
    doc: jest.fn(),
    add: jest.fn(),
  };

  const mockTimestamp = new Date('2020-03-16');

  beforeEach(() => {
    firestoreClient.collection.mockReturnValue(mockCollection);
    Firestore.Timestamp.fromMillis = jest.fn().mockReturnValue(mockTimestamp);

    firestoreAdapter = new FireStoreAdapter('testCollection');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // singleton db reference
  // ---------------------------------------------------------------------------

  it('two FireStoreAdapter instances share the same this.db reference', () => {
    // Both adapters receive firestoreClient via require(); within a single
    // module registry both require() calls return the identical mock object,
    // mirroring how Node module caching works in production.
    const adapterA = new FireStoreAdapter('colA');
    const adapterB = new FireStoreAdapter('colB');

    expect(adapterA.db).toBe(adapterB.db);
  });

  it('FireStoreAdapter does not call the Firestore constructor — it uses the singleton client', () => {
    // FireStoreAdapter only needs Firestore.Timestamp; it must not call
    // new Firestore.Firestore() itself (that would break batch writes in §1.3).
    // Clearing the mock count first ensures we only count calls from this block.
    Firestore.Firestore.mockClear();

    new FireStoreAdapter('colC');

    expect(Firestore.Firestore).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // get()
  // ---------------------------------------------------------------------------

  describe('get()', () => {
    it('returns the DocumentSnapshot when the document exists', async () => {
      const mockDoc = { exists: true, id: 'testId', data: jest.fn() };
      const mockDocRef = { get: jest.fn().mockResolvedValue(mockDoc) };
      mockCollection.doc.mockReturnValue(mockDocRef);

      const doc = await firestoreAdapter.get('testId');

      expect(doc).toEqual(mockDoc);
      expect(mockCollection.doc).toHaveBeenCalledWith('testId');
      expect(mockDocRef.get).toHaveBeenCalled();
    });

    it('throws a boom.notFound error when the document does not exist', async () => {
      const mockDoc = { exists: false };
      const mockDocRef = { get: jest.fn().mockResolvedValue(mockDoc) };
      mockCollection.doc.mockReturnValue(mockDocRef);

      await expect(firestoreAdapter.get('testId')).rejects.toMatchObject({
        isBoom: true,
        output: { statusCode: 404 },
        message: 'Resource not found',
      });

      expect(mockCollection.doc).toHaveBeenCalledWith('testId');
    });
  });

  // ---------------------------------------------------------------------------
  // create()
  // ---------------------------------------------------------------------------

  describe('create()', () => {
    it('returns the DocumentSnapshot after creating the document with timestamps', async () => {
      const mockData = { field: 'value' };
      const mockDoc = {
        id: 'testId',
        data: jest.fn().mockReturnValue(mockData),
      };
      const mockDocRef = { get: jest.fn().mockResolvedValue(mockDoc) };
      mockCollection.add.mockResolvedValue(mockDocRef);

      const doc = await firestoreAdapter.create(mockData);

      expect(doc.data()).toEqual(mockData);
      expect(mockCollection.add).toHaveBeenCalledWith({
        created: mockTimestamp,
        updated: mockTimestamp,
        ...mockData,
      });
    });

    it('throws a boom.badRequest error when Firestore rejects the write', async () => {
      const mockData = { field: 'value' };
      mockCollection.add.mockRejectedValue(new Error('write failed'));

      await expect(firestoreAdapter.create(mockData)).rejects.toMatchObject({
        isBoom: true,
        output: { statusCode: 400 },
        message: 'Error in data',
      });

      expect(mockCollection.add).toHaveBeenCalledWith({
        created: mockTimestamp,
        updated: mockTimestamp,
        ...mockData,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // update()
  // ---------------------------------------------------------------------------

  describe('update()', () => {
    it('returns the updated DocumentSnapshot when the document exists', async () => {
      const mockData = { field: 'value' };
      const mockDoc = {
        exists: true,
        id: 'testId',
        data: jest.fn().mockReturnValue(mockData),
      };
      const mockDocRef = {
        get: jest.fn().mockResolvedValue(mockDoc),
        update: jest.fn().mockResolvedValue(undefined),
      };
      mockCollection.doc.mockReturnValue(mockDocRef);

      const doc = await firestoreAdapter.update('testId', mockData);

      expect(doc.data()).toEqual(mockData);
      expect(mockCollection.doc).toHaveBeenCalledWith('testId');
      expect(mockDocRef.update).toHaveBeenCalledWith({
        updated: mockTimestamp,
        ...mockData,
      });
    });

    it('throws a boom.notFound error when the document does not exist', async () => {
      const mockDoc = { exists: false };
      const mockDocRef = {
        get: jest.fn().mockResolvedValue(mockDoc),
        update: jest.fn(),
      };
      mockCollection.doc.mockReturnValue(mockDocRef);

      await expect(firestoreAdapter.update('testId', {})).rejects.toMatchObject({
        isBoom: true,
        output: { statusCode: 404 },
        message: 'Resource not found',
      });

      expect(mockDocRef.update).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // delete()
  // ---------------------------------------------------------------------------

  describe('delete()', () => {
    it('deletes the document and returns the id when the document exists', async () => {
      const mockDoc = { exists: true };
      const mockDocRef = {
        get: jest.fn().mockResolvedValue(mockDoc),
        delete: jest.fn().mockResolvedValue(undefined),
      };
      mockCollection.doc.mockReturnValue(mockDocRef);

      const id = await firestoreAdapter.delete('testId');

      expect(id).toEqual('testId');
      expect(mockCollection.doc).toHaveBeenCalledWith('testId');
      expect(mockDocRef.delete).toHaveBeenCalled();
    });

    it('throws a boom.notFound error when the document does not exist', async () => {
      const mockDoc = { exists: false };
      const mockDocRef = {
        get: jest.fn().mockResolvedValue(mockDoc),
        delete: jest.fn(),
      };
      mockCollection.doc.mockReturnValue(mockDocRef);

      await expect(firestoreAdapter.delete('testId')).rejects.toMatchObject({
        isBoom: true,
        output: { statusCode: 404 },
        message: 'Resource not found',
      });

      expect(mockDocRef.delete).not.toHaveBeenCalled();
    });

    it('uses the same error message as get() and update() when the document does not exist', async () => {
      // Verify consistency of the not-found message across all three methods.
      const missingDoc = { exists: false };
      const makeDocRef = () => ({
        get: jest.fn().mockResolvedValue(missingDoc),
        update: jest.fn(),
        delete: jest.fn(),
      });

      mockCollection.doc.mockReturnValue(makeDocRef());
      const getError = await firestoreAdapter.get('x').catch((e) => e);

      mockCollection.doc.mockReturnValue(makeDocRef());
      const updateError = await firestoreAdapter.update('x', {}).catch((e) => e);

      mockCollection.doc.mockReturnValue(makeDocRef());
      const deleteError = await firestoreAdapter.delete('x').catch((e) => e);

      expect(getError.message).toBe('Resource not found');
      expect(updateError.message).toBe(getError.message);
      expect(deleteError.message).toBe(getError.message);
    });
  });
});

// ---------------------------------------------------------------------------
// firestore-client singleton — module-level guarantee
// ---------------------------------------------------------------------------
// These tests load firestore-client.js through its real path (bypassing the
// module-level mock) using jest.isolateModules, which creates a fresh module
// registry for each callback. Within a single callback the registry behaves
// exactly like Node's require() cache: the same module path returns the same
// object, regardless of how many times it is required.
//
// The @google-cloud/firestore auto-mock (declared at module level) still
// applies inside isolateModules, so no real GCP connection is attempted.

describe('firestore-client singleton', () => {
  it('returns the same object reference on every require() within the same registry', () => {
    let client1;
    let client2;
    jest.isolateModules(() => {
      client1 = require('../firestore-client');
      client2 = require('../firestore-client');
    });
    expect(client1).toBe(client2);
  });

  it('FireStoreAdapter.db is the same object as the firestore-client module export', () => {
    // This verifies that FireStoreAdapter assigns this.db = firestoreClient
    // (the singleton) rather than constructing a new client independently.
    let client;
    let adapter;
    jest.isolateModules(() => {
      client = require('../firestore-client');
      const FreshAdapter = require('../firestore');
      adapter = new FreshAdapter('colA');
    });
    expect(adapter.db).toBe(client);
  });
});
