const Firestore = require('@google-cloud/firestore');
const FireStoreAdapter = require('../firestore');
const boom = require('@hapi/boom');

jest.mock('@google-cloud/firestore');

describe('FireStoreAdapter', () => {
  let firestoreAdapter;
  const mockCollection = {
    doc: jest.fn(),
  };
  const mockDb = {
    collection: jest.fn().mockReturnValue(mockCollection),
  };

  const mockTimestamp = new Date('2020-03-16');

  beforeEach(() => {
    Firestore.Firestore.mockReturnValue(mockDb);
    Firestore.Timestamp.fromMillis = jest.fn().mockReturnValue(mockTimestamp);

    firestoreAdapter = new FireStoreAdapter('testCollection');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should get document by id', async () => {
    const mockDoc = {
      exists: true,
      id: 'testId',
      data: jest.fn(),
    };
    const mockDocRef = {
      get: jest.fn().mockResolvedValue(mockDoc),
    };
    mockCollection.doc.mockReturnValue(mockDocRef);

    const doc = await firestoreAdapter.getById('testId');

    expect(doc).toEqual(mockDoc);
    expect(mockCollection.doc).toHaveBeenCalledWith('testId');
    expect(mockDocRef.get).toHaveBeenCalled();
  });

  it('should throw error when document not found', async () => {
    const mockDoc = {
      exists: false,
    };
    const mockDocRef = {
      get: jest.fn().mockResolvedValue(mockDoc),
    };
    mockCollection.doc.mockReturnValue(mockDocRef);

    await expect(firestoreAdapter.getById('testId')).rejects.toThrow(
      boom.notFound('Resource not found')
    );

    expect(mockCollection.doc).toHaveBeenCalledWith('testId');
    expect(mockDocRef.get).toHaveBeenCalled();
  });

  it('should create a new document', async () => {
    const mockData = { field: 'value' };
    const mockDoc = {
      exists: false,
      id: 'testId',
      data: jest.fn().mockReturnValue(mockData),
    };
    const mockDocRef = {
      get: jest.fn().mockResolvedValue(mockDoc),
      create: jest.fn().mockResolvedValue(mockData),
    };
    mockCollection.doc.mockReturnValue(mockDocRef);

    const doc = await firestoreAdapter.create('testId', mockData);

    expect(doc.data()).toEqual(mockData);
    expect(mockCollection.doc).toHaveBeenCalledWith('testId');
    expect(mockDocRef.create).toHaveBeenCalledWith({
      created: mockTimestamp,
      updated: mockTimestamp,
      ...mockData,
    });
  });

  it('should throw error when document already exists', async () => {
    const mockData = { field: 'value' };
    const mockDocRef = {
      get: jest.fn(),
      create: jest.fn().mockRejectedValue(new Error()),
    };
    mockCollection.doc.mockReturnValue(mockDocRef);

    await expect(firestoreAdapter.create('testId', mockData)).rejects.toThrow(
      boom.conflict('Document already created with id testId')
    );

    expect(mockCollection.doc).toHaveBeenCalledWith('testId');
    expect(mockDocRef.create).toHaveBeenCalledWith({
      created: mockTimestamp,
      updated: mockTimestamp,
      ...mockData,
    });
  });

  it('should update a document', async () => {
    const mockData = { field: 'value' };
    const mockDoc = {
      exists: true,
      id: 'testId',
      data: jest.fn().mockReturnValue(mockData),
    };
    const mockDocRef = {
      get: jest.fn().mockResolvedValue(mockDoc),
      set: jest.fn().mockResolvedValue(mockData),
    };
    mockCollection.doc.mockReturnValue(mockDocRef);

    const doc = await firestoreAdapter.update('testId', mockData);

    expect(doc.data()).toEqual(mockData);
    expect(mockCollection.doc).toHaveBeenCalledWith('testId');
    expect(mockDocRef.set).toHaveBeenCalledWith({
      updated: mockTimestamp,
      ...mockData,
    });
  });

  it('should delete a document', async () => {
    const mockDocRef = {
      delete: jest.fn().mockResolvedValue(),
    };
    mockCollection.doc.mockReturnValue(mockDocRef);

    const id = await firestoreAdapter.delete('testId');

    expect(id).toEqual('testId');
    expect(mockCollection.doc).toHaveBeenCalledWith('testId');
    expect(mockDocRef.delete).toHaveBeenCalled();
  });
});
