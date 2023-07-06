const RedirectService = require('../services/redirect.service');
const FireStoreAdapter = require('../../lib/firestore');
const Redirect = require('../models/redirect.model');

jest.mock('../../lib/firestore');

describe('RedirectService', () => {
  let redirectService;
  const mockDb = {
    getById: jest.fn(),
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
    const mockPath = 'testPath';
    const mockData = {
      path: mockPath,
      url: 'https://example.com',
      updated: new Date('2020-03-16'),
    };
    const mockDoc = {
      data: jest.fn().mockReturnValue(mockData),
    };
    mockDb.getById.mockResolvedValue(mockDoc);

    const redirect = await redirectService.getByPath(mockPath);
    expect(redirect).toEqual(new Redirect(mockData));
    expect(mockDb.getById).toHaveBeenCalledWith(
      new Redirect({ path: mockPath }).id
    );
  });

  it('should create a new redirect', async () => {
    const mockData = new Redirect({
      path: 'testPath',
      url: 'https://example.com',
    });
    const mockDoc = {
      id: 'testId',
    };
    mockDb.create.mockResolvedValue(mockDoc);

    const id = await redirectService.create(mockData);

    expect(id).toEqual(mockDoc.id);
    expect(mockDb.create).toHaveBeenCalledWith(mockData.id, mockData);
  });
});
