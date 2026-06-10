/**
 * Unit tests for GroupService.
 *
 * Strategy:
 * - FireStoreAdapter is fully mocked — the mock constructor returns a shared
 *   mockDb object that test bodies configure per-test.
 * - UserServices is injected by constructor and mocked as a plain object with
 *   jest.fn() methods. GroupService requires userService to be passed in.
 * - boom is NOT mocked — GroupService throws real boom objects; tests inspect
 *   e.output.statusCode to verify error semantics.
 */

jest.mock('@google-cloud/firestore');
jest.mock('../../../../lib/firestore');

const FireStoreAdapter = require('../../../../lib/firestore');
const GroupService = require('../group.service.api');
const { Group } = require('../../models/group.model.api');

// ---- Shared mock FireStore db ----
let mockDb;

// ---- Shared mock UserServices ----
let mockUserService;

// ---- Helper: build a mock DocumentSnapshot ----
function makeDocSnap({ id = 'group-1', name = 'Facultad de Ciencias', slug = 'fc', users = [] } = {}) {
  return {
    ref: { id },
    data: () => ({
      name,
      slug,
      users,
      created: { toMillis: () => 1000000 },
      updated: { toMillis: () => 2000000 },
    }),
  };
}

// ---- Helper: build a mock QuerySnapshot ----
function makeQuerySnap(docs) {
  return { empty: docs.length === 0, docs };
}

beforeEach(() => {
  mockDb = {
    get: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    collection: {
      where: jest.fn().mockReturnThis(),
      get: jest.fn(),
      orderBy: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
    },
  };
  FireStoreAdapter.mockImplementation(() => mockDb);

  mockUserService = {
    getByEmail: jest.fn(),
    update: jest.fn(),
  };
});

afterEach(() => jest.clearAllMocks());

// ─────────────────────────────────────────────────────────────────────────────
// getBySlug
// ─────────────────────────────────────────────────────────────────────────────
describe('GroupService.getBySlug()', () => {
  it('returns the parsed Group when Firestore returns a matching document', async () => {
    const docSnap = makeDocSnap({ id: 'group-1', slug: 'fc' });
    mockDb.collection.get.mockResolvedValue(makeQuerySnap([docSnap]));

    const service = new GroupService(mockUserService);
    const result = await service.getBySlug('fc');

    expect(result).toMatchObject({ id: 'group-1', slug: 'fc' });
  });

  it('queries Firestore with where("slug", "==", slug)', async () => {
    const docSnap = makeDocSnap({ slug: 'fc' });
    mockDb.collection.get.mockResolvedValue(makeQuerySnap([docSnap]));

    const service = new GroupService(mockUserService);
    await service.getBySlug('fc');

    expect(mockDb.collection.where).toHaveBeenCalledWith('slug', '==', 'fc');
  });

  it('throws boom 404 when the query snapshot is empty', async () => {
    mockDb.collection.get.mockResolvedValue(makeQuerySnap([]));

    const service = new GroupService(mockUserService);
    let err;
    try {
      await service.getBySlug('does-not-exist');
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.output.statusCode).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// create
// ─────────────────────────────────────────────────────────────────────────────
describe('GroupService.create()', () => {
  it('creates and returns the new group when slug does not exist yet', async () => {
    // getBySlug → empty → throws 404 (slug available)
    mockDb.collection.get.mockResolvedValue(makeQuerySnap([]));
    const createdSnap = makeDocSnap({ id: 'new-group', slug: 'cs' });
    mockDb.create.mockResolvedValue(createdSnap);

    const service = new GroupService(mockUserService);
    const group = new Group({ name: 'Ciencias', slug: 'cs' });
    const result = await service.create(group);

    expect(result).toMatchObject({ id: 'new-group', slug: 'cs' });
    expect(mockDb.create).toHaveBeenCalledTimes(1);
  });

  it('calls db.create with the output of createGroupParser', async () => {
    mockDb.collection.get.mockResolvedValue(makeQuerySnap([]));
    const createdSnap = makeDocSnap({ slug: 'cs' });
    mockDb.create.mockResolvedValue(createdSnap);

    const service = new GroupService(mockUserService);
    const group = new Group({ name: 'Ciencias', slug: 'cs', users: ['a@test.com'] });
    await service.create(group);

    const payload = mockDb.create.mock.calls[0][0];
    expect(payload).toMatchObject({ name: 'Ciencias', slug: 'cs', users: ['a@test.com'] });
    expect(payload.id).toBeUndefined();
  });

  it('throws boom 400 "Slug already taken" when slug already exists', async () => {
    const existingSnap = makeDocSnap({ slug: 'fc' });
    mockDb.collection.get.mockResolvedValue(makeQuerySnap([existingSnap]));

    const service = new GroupService(mockUserService);
    const group = new Group({ name: 'Duplicate', slug: 'fc' });
    let err;
    try {
      await service.create(group);
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.output.statusCode).toBe(400);
    expect(err.message).toBe('Slug already taken');
  });

  it('does not call db.create when slug already exists', async () => {
    const existingSnap = makeDocSnap({ slug: 'fc' });
    mockDb.collection.get.mockResolvedValue(makeQuerySnap([existingSnap]));

    const service = new GroupService(mockUserService);
    const group = new Group({ name: 'Duplicate', slug: 'fc' });
    try { await service.create(group); } catch (_) { /* expected */ }

    expect(mockDb.create).not.toHaveBeenCalled();
  });

  it('rethrows non-404 errors from getBySlug', async () => {
    const unexpectedErr = { output: { statusCode: 500 }, message: 'Firestore down' };
    mockDb.collection.get.mockRejectedValue(unexpectedErr);

    const service = new GroupService(mockUserService);
    const group = new Group({ name: 'Test', slug: 'test' });
    let err;
    try {
      await service.create(group);
    } catch (e) {
      err = e;
    }
    expect(err).toBe(unexpectedErr);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// update
// ─────────────────────────────────────────────────────────────────────────────
describe('GroupService.update()', () => {
  // Helper: configure mockDb for findOne (via db.get)
  function setupFindOne(snap) {
    mockDb.get.mockResolvedValue(snap);
  }

  // Helper: configure mockDb.update to return a snapshot
  function setupDbUpdate(snap) {
    mockDb.update.mockResolvedValue(snap);
  }

  it('skips user sync and calls super.update() directly when group.users is undefined', async () => {
    const updatedSnap = makeDocSnap({ id: 'g-1', name: 'New Name', slug: 'fc' });
    setupDbUpdate(updatedSnap);

    const service = new GroupService(mockUserService);
    const group = new Group({ id: 'g-1', name: 'New Name', slug: 'fc' });
    // users is undefined — no sync needed
    expect(group.users).toBeUndefined();

    await service.update('g-1', group);

    expect(mockUserService.getByEmail).not.toHaveBeenCalled();
    expect(mockUserService.update).not.toHaveBeenCalled();
    expect(mockDb.update).toHaveBeenCalledTimes(1);
  });

  it('calls super.update() with the group object', async () => {
    const updatedSnap = makeDocSnap({ id: 'g-1', name: 'New Name', slug: 'fc' });
    setupDbUpdate(updatedSnap);

    const service = new GroupService(mockUserService);
    const group = new Group({ id: 'g-1', name: 'New Name', slug: 'fc' });

    const result = await service.update('g-1', group);
    expect(result).toMatchObject({ id: 'g-1', name: 'New Name' });
  });

  it('skips user sync when diff is empty — users array unchanged', async () => {
    const currentSnap = makeDocSnap({ id: 'g-1', slug: 'fc', users: ['a@test.com'] });
    setupFindOne(currentSnap);
    const updatedSnap = makeDocSnap({ id: 'g-1', slug: 'fc', users: ['a@test.com'] });
    setupDbUpdate(updatedSnap);

    const service = new GroupService(mockUserService);
    const group = new Group({ id: 'g-1', slug: 'fc', users: ['a@test.com'] });

    await service.update('g-1', group);

    expect(mockUserService.getByEmail).not.toHaveBeenCalled();
    expect(mockUserService.update).not.toHaveBeenCalled();
    expect(mockDb.update).toHaveBeenCalledTimes(1);
  });

  it('fetches and updates user when a new member is added', async () => {
    const currentSnap = makeDocSnap({ id: 'g-1', slug: 'fc', users: [] });
    setupFindOne(currentSnap);

    const userObj = {
      id: 'user-1',
      email: 'new@test.com',
      groups: [],
      role: 'user',
      firstName: 'New',
      lastName: 'User',
    };
    mockUserService.getByEmail.mockResolvedValue(userObj);
    mockUserService.update.mockResolvedValue(userObj);

    const updatedSnap = makeDocSnap({ id: 'g-1', slug: 'fc', users: ['new@test.com'] });
    setupDbUpdate(updatedSnap);

    const service = new GroupService(mockUserService);
    const group = new Group({ id: 'g-1', slug: 'fc', users: ['new@test.com'] });

    await service.update('g-1', group);

    expect(mockUserService.getByEmail).toHaveBeenCalledWith('new@test.com');
    expect(mockUserService.update).toHaveBeenCalledTimes(1);
    // The updated user should have 'fc' in their groups
    const updatedUser = mockUserService.update.mock.calls[0][0];
    expect(updatedUser.groups).toContain('fc');
  });

  it('fetches and updates user when a member is removed', async () => {
    const currentSnap = makeDocSnap({ id: 'g-1', slug: 'fc', users: ['leaving@test.com'] });
    setupFindOne(currentSnap);

    const userObj = {
      id: 'user-2',
      email: 'leaving@test.com',
      groups: ['fc'],
      role: 'user',
      firstName: 'Leaving',
      lastName: 'User',
    };
    mockUserService.getByEmail.mockResolvedValue(userObj);
    mockUserService.update.mockResolvedValue(userObj);

    const updatedSnap = makeDocSnap({ id: 'g-1', slug: 'fc', users: [] });
    setupDbUpdate(updatedSnap);

    const service = new GroupService(mockUserService);
    const group = new Group({ id: 'g-1', slug: 'fc', users: [] });

    await service.update('g-1', group);

    expect(mockUserService.getByEmail).toHaveBeenCalledWith('leaving@test.com');
    expect(mockUserService.update).toHaveBeenCalledTimes(1);
    // The updated user should NOT have 'fc' in their groups
    const updatedUser = mockUserService.update.mock.calls[0][0];
    expect(updatedUser.groups).not.toContain('fc');
  });

  it('calls super.update() AFTER syncing all users', async () => {
    const callOrder = [];
    const currentSnap = makeDocSnap({ id: 'g-1', slug: 'fc', users: [] });
    setupFindOne(currentSnap);

    const userObj = { id: 'u-1', email: 'a@test.com', groups: [], role: 'user', firstName: '', lastName: '' };
    mockUserService.getByEmail.mockResolvedValue(userObj);
    mockUserService.update.mockImplementation(() => {
      callOrder.push('userService.update');
      return Promise.resolve(userObj);
    });

    const updatedSnap = makeDocSnap({ id: 'g-1', slug: 'fc', users: ['a@test.com'] });
    mockDb.update.mockImplementation(() => {
      callOrder.push('db.update');
      return Promise.resolve(updatedSnap);
    });

    const service = new GroupService(mockUserService);
    const group = new Group({ id: 'g-1', slug: 'fc', users: ['a@test.com'] });

    await service.update('g-1', group);

    expect(callOrder).toEqual(['userService.update', 'db.update']);
  });

  it('throws boom 400 when a user in the diff does not exist — fetch-first guard', async () => {
    const currentSnap = makeDocSnap({ id: 'g-1', slug: 'fc', users: [] });
    setupFindOne(currentSnap);

    // getByEmail throws boom 404
    const notFoundErr = { output: { statusCode: 404 }, message: 'User not found' };
    mockUserService.getByEmail.mockRejectedValue(notFoundErr);

    const service = new GroupService(mockUserService);
    const group = new Group({ id: 'g-1', slug: 'fc', users: ['ghost@test.com'] });

    let err;
    try {
      await service.update('g-1', group);
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.output.statusCode).toBe(400);
    expect(err.message).toBe('User not found: ghost@test.com');
  });

  it('does not call super.update() when fetch-first guard fails', async () => {
    const currentSnap = makeDocSnap({ id: 'g-1', slug: 'fc', users: [] });
    setupFindOne(currentSnap);

    const notFoundErr = { output: { statusCode: 404 }, message: 'User not found' };
    mockUserService.getByEmail.mockRejectedValue(notFoundErr);

    const service = new GroupService(mockUserService);
    const group = new Group({ id: 'g-1', slug: 'fc', users: ['ghost@test.com'] });

    try { await service.update('g-1', group); } catch (_) { /* expected */ }

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('rethrows non-404 errors from getByEmail', async () => {
    const currentSnap = makeDocSnap({ id: 'g-1', slug: 'fc', users: [] });
    setupFindOne(currentSnap);

    const serverErr = { output: { statusCode: 500 }, message: 'DB error' };
    mockUserService.getByEmail.mockRejectedValue(serverErr);

    const service = new GroupService(mockUserService);
    const group = new Group({ id: 'g-1', slug: 'fc', users: ['a@test.com'] });

    let err;
    try {
      await service.update('g-1', group);
    } catch (e) {
      err = e;
    }
    expect(err).toBe(serverErr);
  });

  it('fetches all users in the diff before performing any writes', async () => {
    const currentSnap = makeDocSnap({ id: 'g-1', slug: 'fc', users: ['old@test.com'] });
    setupFindOne(currentSnap);

    const fetchOrder = [];
    const oldUser = { id: 'u-1', email: 'old@test.com', groups: ['fc'], role: 'user', firstName: '', lastName: '' };
    const newUser = { id: 'u-2', email: 'new@test.com', groups: [], role: 'user', firstName: '', lastName: '' };

    mockUserService.getByEmail.mockImplementation((email) => {
      fetchOrder.push(`fetch:${email}`);
      return Promise.resolve(email === 'old@test.com' ? oldUser : newUser);
    });
    mockUserService.update.mockResolvedValue({});

    const updatedSnap = makeDocSnap({ id: 'g-1', slug: 'fc', users: ['new@test.com'] });
    setupDbUpdate(updatedSnap);

    const service = new GroupService(mockUserService);
    // old@test.com removed, new@test.com added
    const group = new Group({ id: 'g-1', slug: 'fc', users: ['new@test.com'] });

    await service.update('g-1', group);

    // Both users should be fetched
    expect(fetchOrder).toContain('fetch:new@test.com');
    expect(fetchOrder).toContain('fetch:old@test.com');
  });

  it('rethrows error and skips db.update when userService.update fails adding a member', async () => {
    const currentSnap = makeDocSnap({ id: 'g-1', slug: 'fc', users: [] });
    setupFindOne(currentSnap);

    const userObj = { id: 'u-1', email: 'new@test.com', groups: [], role: 'user', firstName: '', lastName: '' };
    mockUserService.getByEmail.mockResolvedValue(userObj);

    const syncErr = new Error('Write failed');
    mockUserService.update.mockRejectedValue(syncErr);

    const service = new GroupService(mockUserService);
    const group = new Group({ id: 'g-1', slug: 'fc', users: ['new@test.com'] });

    let err;
    try {
      await service.update('g-1', group);
    } catch (e) {
      err = e;
    }

    expect(err).toBe(syncErr);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('rethrows error and skips db.update when userService.update fails removing a member', async () => {
    const currentSnap = makeDocSnap({ id: 'g-1', slug: 'fc', users: ['leaving@test.com'] });
    setupFindOne(currentSnap);

    const userObj = { id: 'u-2', email: 'leaving@test.com', groups: ['fc'], role: 'user', firstName: '', lastName: '' };
    mockUserService.getByEmail.mockResolvedValue(userObj);

    const syncErr = new Error('Write failed');
    mockUserService.update.mockRejectedValue(syncErr);

    const service = new GroupService(mockUserService);
    const group = new Group({ id: 'g-1', slug: 'fc', users: [] });

    let err;
    try {
      await service.update('g-1', group);
    } catch (e) {
      err = e;
    }

    expect(err).toBe(syncErr);
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});
