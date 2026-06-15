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
