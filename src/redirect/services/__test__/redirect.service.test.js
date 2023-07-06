const RedirectService = require('../redirect.service');
const FireStoreAdapter = require('../../../lib/firestore');
const Redirect = require('../../models/redirect.model');
const boom = require('@hapi/boom');
const {
  redirectParser,
} = require('../../parsers/redirect.parsers');

jest.mock('../../../lib/firestore');
jest.mock('../../models/redirect.model');
jest.mock('../../parsers/redirect.parsers');

describe('RedirectService', () => {
  let redirectService;
  const mockDb = {
    collection: {
      where: jest.fn(),
    },
    get: jest.fn(),
    create: jest.fn(),
  };

  beforeEach(() => {
    FireStoreAdapter.mockReturnValue(mockDb);
    redirectService = new RedirectService();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should get redirect by path', async () => {
    const mockPath = '/test-path';
    const mockDoc = { path: '/test-id' };
    const mockQuery = {
      get: jest.fn().mockResolvedValue({ empty: false, docs: [mockDoc] }),
    };
    mockDb.collection.where.mockReturnValue(mockQuery);

    await redirectService.getByPath(mockPath);

    expect(mockDb.collection.where).toHaveBeenCalledWith(
      'path',
      '==',
      mockPath
    );
    expect(mockQuery.get).toHaveBeenCalled();
    expect(redirectParser).toHaveBeenCalledWith(mockDoc);
  });

  it('should throw not found error if no redirect found', async () => {
    const mockPath = '/test-path';
    const mockQuery = {
      get: jest.fn().mockResolvedValue({ empty: true }),
    };
    mockDb.collection.where.mockReturnValue(mockQuery);

    await expect(redirectService.getByPath(mockPath)).rejects.toThrow(
      boom.notFound('Resource not found')
    );

    expect(mockDb.collection.where).toHaveBeenCalledWith(
      'path',
      '==',
      mockPath
    );
    expect(mockQuery.get).toHaveBeenCalled();
  });
});
