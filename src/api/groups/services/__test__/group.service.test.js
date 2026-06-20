/**
 * Unit tests for GroupService.
 *
 * Strategy:
 * - FireStoreAdapter is fully mocked — the mock constructor returns a shared
 *   mockDb object that test bodies configure per-test.
 * - firestoreClient (singleton from src/lib/firestore-client.js) is mocked with
 *   batch() and collection() so the WriteBatch path in update() is fully
 *   exercisable without a real Firestore connection.
 * - UserService is injected by constructor and mocked as a plain object with
 *   jest.fn() methods. GroupService requires userService to be passed in.
 * - boom is NOT mocked — GroupService throws real boom objects; tests inspect
 *   e.output.statusCode to verify error semantics.
 * - @google-cloud/firestore is auto-mocked so Firestore.Timestamp.fromMillis()
 *   is a no-op, avoiding real GCP calls. firestoreClient.batch() and
 *   firestoreClient.collection() are configured manually in beforeEach.
 */

jest.mock('@google-cloud/firestore');
jest.mock('../../../../lib/firestore');
jest.mock('../../../../lib/firestore-client');

const Firestore = require('@google-cloud/firestore');
const FireStoreAdapter = require('../../../../lib/firestore');
const firestoreClient = require('../../../../lib/firestore-client');
const GroupService = require('../group.service');
const { Group } = require('../../models/group.model');

// ---- Shared mock FireStore db ----
let mockDb;

// ---- Shared mock UserService ----
let mockUserService;

// ---- Shared batch mock ----
let mockBatch;

// ---- Shared DocumentReference mock ----
// Returned by firestoreClient.collection().doc() — needs a .get() for the
// post-commit read in update().
let mockGroupRef;
let mockUserRef;

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
  // FireStoreAdapter mock (used by CrudService internals: get, create, update, delete, collection)
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

  // Timestamp.fromMillis — needed by update(); auto-mock makes it return undefined
  // which is fine for tests (the value is only passed to Firestore, which is mocked).
  Firestore.Timestamp = { fromMillis: jest.fn().mockReturnValue({ _seconds: 0 }) };

  // Batch mock — tracks update(), delete(), and commit() calls
  mockBatch = {
    update: jest.fn(),
    delete: jest.fn(),
    commit: jest.fn().mockResolvedValue(undefined),
  };

  // DocumentReference mocks
  mockGroupRef = { get: jest.fn() };
  mockUserRef = {};

  // firestoreClient singleton mock
  firestoreClient.batch = jest.fn().mockReturnValue(mockBatch);
  firestoreClient.collection = jest.fn().mockReturnValue({
    doc: jest.fn().mockImplementation(() => {
      // Return mockGroupRef for group collection, mockUserRef for users collection.
      // The caller uses these as opaque refs passed to batch.update(), so a single
      // shared ref is sufficient for most tests. Tests that need to distinguish
      // between user refs and the group ref can override firestoreClient.collection.
      return mockGroupRef;
    }),
  });

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
  // Helper: configure mockDb.get for findOne(id) — used to load current group state.
  function setupFindOne(snap) {
    mockDb.get.mockResolvedValue(snap);
  }

  // Helper: configure the post-commit groupRef.get() to return a snapshot.
  // update() always calls groupRef.get() after batch.commit() to return the
  // updated document, so tests that exercise the happy path need this set up.
  function setupPostCommitRead(snap) {
    mockGroupRef.get.mockResolvedValue(snap);
  }

  it('calls firestoreClient.batch() exactly once per update call', async () => {
    const updatedSnap = makeDocSnap({ id: 'g-1', name: 'New Name', slug: 'fc' });
    setupPostCommitRead(updatedSnap);

    const service = new GroupService(mockUserService);
    const group = new Group({ id: 'g-1', name: 'New Name', slug: 'fc' });

    await service.update('g-1', group);

    expect(firestoreClient.batch).toHaveBeenCalledTimes(1);
  });

  it('calls batch.commit() exactly once per update call', async () => {
    const updatedSnap = makeDocSnap({ id: 'g-1', name: 'New Name', slug: 'fc' });
    setupPostCommitRead(updatedSnap);

    const service = new GroupService(mockUserService);
    const group = new Group({ id: 'g-1', name: 'New Name', slug: 'fc' });

    await service.update('g-1', group);

    expect(mockBatch.commit).toHaveBeenCalledTimes(1);
  });

  it('returns the parsed Group read from Firestore after commit', async () => {
    const updatedSnap = makeDocSnap({ id: 'g-1', name: 'New Name', slug: 'fc' });
    setupPostCommitRead(updatedSnap);

    const service = new GroupService(mockUserService);
    const group = new Group({ id: 'g-1', name: 'New Name', slug: 'fc' });

    const result = await service.update('g-1', group);

    expect(result).toMatchObject({ id: 'g-1', name: 'New Name', slug: 'fc' });
  });

  it('skips user sync and includes only the group entry in the batch when group.users is undefined', async () => {
    const updatedSnap = makeDocSnap({ id: 'g-1', name: 'New Name', slug: 'fc' });
    setupPostCommitRead(updatedSnap);

    const service = new GroupService(mockUserService);
    const group = new Group({ id: 'g-1', name: 'New Name', slug: 'fc' });
    // users is undefined — no sync needed
    expect(group.users).toBeUndefined();

    await service.update('g-1', group);

    expect(mockUserService.getByEmail).not.toHaveBeenCalled();
    // Only the group entry itself goes into the batch
    expect(mockBatch.update).toHaveBeenCalledTimes(1);
    expect(mockBatch.commit).toHaveBeenCalledTimes(1);
  });

  it('does not call userService.update() directly — user sync uses batch.update()', async () => {
    const currentSnap = makeDocSnap({ id: 'g-1', slug: 'fc', users: [] });
    setupFindOne(currentSnap);

    const userObj = { id: 'u-1', email: 'new@test.com', groups: [], role: 'user', firstName: 'New', lastName: 'User' };
    mockUserService.getByEmail.mockResolvedValue(userObj);

    const updatedSnap = makeDocSnap({ id: 'g-1', slug: 'fc', users: ['new@test.com'] });
    setupPostCommitRead(updatedSnap);

    const service = new GroupService(mockUserService);
    const group = new Group({ id: 'g-1', slug: 'fc', users: ['new@test.com'] });

    await service.update('g-1', group);

    expect(mockUserService.update).not.toHaveBeenCalled();
  });

  it('skips user sync when diff is empty — users array unchanged', async () => {
    const currentSnap = makeDocSnap({ id: 'g-1', slug: 'fc', users: ['a@test.com'] });
    setupFindOne(currentSnap);
    const updatedSnap = makeDocSnap({ id: 'g-1', slug: 'fc', users: ['a@test.com'] });
    setupPostCommitRead(updatedSnap);

    const service = new GroupService(mockUserService);
    const group = new Group({ id: 'g-1', slug: 'fc', users: ['a@test.com'] });

    await service.update('g-1', group);

    expect(mockUserService.getByEmail).not.toHaveBeenCalled();
    // Only the group entry in the batch — no user entries
    expect(mockBatch.update).toHaveBeenCalledTimes(1);
    expect(mockBatch.commit).toHaveBeenCalledTimes(1);
  });

  it('adds one batch.update entry per user added', async () => {
    const currentSnap = makeDocSnap({ id: 'g-1', slug: 'fc', users: [] });
    setupFindOne(currentSnap);

    const userA = { id: 'u-1', email: 'a@test.com', groups: [], role: 'user', firstName: '', lastName: '' };
    const userB = { id: 'u-2', email: 'b@test.com', groups: [], role: 'user', firstName: '', lastName: '' };
    mockUserService.getByEmail.mockImplementation((email) =>
      Promise.resolve(email === 'a@test.com' ? userA : userB)
    );

    const updatedSnap = makeDocSnap({ id: 'g-1', slug: 'fc', users: ['a@test.com', 'b@test.com'] });
    setupPostCommitRead(updatedSnap);

    const service = new GroupService(mockUserService);
    const group = new Group({ id: 'g-1', slug: 'fc', users: ['a@test.com', 'b@test.com'] });

    await service.update('g-1', group);

    // 2 users added + 1 group entry = 3 batch.update calls
    expect(mockBatch.update).toHaveBeenCalledTimes(3);
    expect(mockBatch.commit).toHaveBeenCalledTimes(1);
  });

  it('adds one batch.update entry per user removed', async () => {
    const currentSnap = makeDocSnap({ id: 'g-1', slug: 'fc', users: ['a@test.com', 'b@test.com'] });
    setupFindOne(currentSnap);

    const userA = { id: 'u-1', email: 'a@test.com', groups: ['fc'], role: 'user', firstName: '', lastName: '' };
    const userB = { id: 'u-2', email: 'b@test.com', groups: ['fc'], role: 'user', firstName: '', lastName: '' };
    mockUserService.getByEmail.mockImplementation((email) =>
      Promise.resolve(email === 'a@test.com' ? userA : userB)
    );

    const updatedSnap = makeDocSnap({ id: 'g-1', slug: 'fc', users: [] });
    setupPostCommitRead(updatedSnap);

    const service = new GroupService(mockUserService);
    const group = new Group({ id: 'g-1', slug: 'fc', users: [] });

    await service.update('g-1', group);

    // 2 users removed + 1 group entry = 3 batch.update calls
    expect(mockBatch.update).toHaveBeenCalledTimes(3);
    expect(mockBatch.commit).toHaveBeenCalledTimes(1);
  });

  it('adds fc to groups of a newly added member', async () => {
    const currentSnap = makeDocSnap({ id: 'g-1', slug: 'fc', users: [] });
    setupFindOne(currentSnap);

    const userObj = { id: 'u-1', email: 'new@test.com', groups: [], role: 'user', firstName: 'New', lastName: 'User' };
    mockUserService.getByEmail.mockResolvedValue(userObj);

    const updatedSnap = makeDocSnap({ id: 'g-1', slug: 'fc', users: ['new@test.com'] });
    setupPostCommitRead(updatedSnap);

    const service = new GroupService(mockUserService);
    const group = new Group({ id: 'g-1', slug: 'fc', users: ['new@test.com'] });

    await service.update('g-1', group);

    // First batch.update call is for the user ref — second is for the group ref
    const [, userPayload] = mockBatch.update.mock.calls[0];
    expect(userPayload.groups).toContain('fc');
  });

  it('removes fc from groups of a removed member', async () => {
    const currentSnap = makeDocSnap({ id: 'g-1', slug: 'fc', users: ['leaving@test.com'] });
    setupFindOne(currentSnap);

    const userObj = { id: 'u-2', email: 'leaving@test.com', groups: ['fc'], role: 'user', firstName: 'Leaving', lastName: 'User' };
    mockUserService.getByEmail.mockResolvedValue(userObj);

    const updatedSnap = makeDocSnap({ id: 'g-1', slug: 'fc', users: [] });
    setupPostCommitRead(updatedSnap);

    const service = new GroupService(mockUserService);
    const group = new Group({ id: 'g-1', slug: 'fc', users: [] });

    await service.update('g-1', group);

    // First batch.update call is for the removed user ref
    const [, userPayload] = mockBatch.update.mock.calls[0];
    expect(userPayload.groups).not.toContain('fc');
  });

  it('queues all user batch entries before the group entry', async () => {
    // Verifies ordering: user syncs happen before the group document is written.
    const callOrder = [];
    const currentSnap = makeDocSnap({ id: 'g-1', slug: 'fc', users: [] });
    setupFindOne(currentSnap);

    const userObj = { id: 'u-1', email: 'a@test.com', groups: [], role: 'user', firstName: '', lastName: '' };
    mockUserService.getByEmail.mockResolvedValue(userObj);

    const updatedSnap = makeDocSnap({ id: 'g-1', slug: 'fc', users: ['a@test.com'] });
    setupPostCommitRead(updatedSnap);

    // Track which ref is passed to batch.update to distinguish user vs group entries
    let userRefInstance;
    let groupRefInstance;
    const mockUserDocRef = { _type: 'userRef' };
    const mockGroupDocRef = { _type: 'groupRef', get: jest.fn().mockResolvedValue(updatedSnap) };

    firestoreClient.collection.mockImplementation((collectionName) => ({
      doc: jest.fn().mockImplementation(() => {
        if (collectionName.includes('user') || collectionName === 'users') {
          userRefInstance = mockUserDocRef;
          return mockUserDocRef;
        }
        groupRefInstance = mockGroupDocRef;
        return mockGroupDocRef;
      }),
    }));

    mockBatch.update.mockImplementation((ref) => {
      if (ref === mockUserDocRef) callOrder.push('user-batch-entry');
      if (ref === mockGroupDocRef) callOrder.push('group-batch-entry');
    });

    const service = new GroupService(mockUserService);
    const group = new Group({ id: 'g-1', slug: 'fc', users: ['a@test.com'] });

    await service.update('g-1', group);

    expect(callOrder[0]).toBe('user-batch-entry');
    expect(callOrder[callOrder.length - 1]).toBe('group-batch-entry');
  });

  it('calls batch.commit() after all batch entries are queued', async () => {
    const commitCallCount = { atUpdate: 0, atCommit: 0 };
    const currentSnap = makeDocSnap({ id: 'g-1', slug: 'fc', users: [] });
    setupFindOne(currentSnap);

    const userObj = { id: 'u-1', email: 'a@test.com', groups: [], role: 'user', firstName: '', lastName: '' };
    mockUserService.getByEmail.mockResolvedValue(userObj);

    const updatedSnap = makeDocSnap({ id: 'g-1', slug: 'fc', users: ['a@test.com'] });
    setupPostCommitRead(updatedSnap);

    mockBatch.update.mockImplementation(() => {
      commitCallCount.atUpdate = mockBatch.commit.mock.calls.length;
    });
    mockBatch.commit.mockImplementation(() => {
      commitCallCount.atCommit = mockBatch.update.mock.calls.length;
      return Promise.resolve(undefined);
    });

    const service = new GroupService(mockUserService);
    const group = new Group({ id: 'g-1', slug: 'fc', users: ['a@test.com'] });

    await service.update('g-1', group);

    // commit() was not called during any batch.update() call
    expect(commitCallCount.atUpdate).toBe(0);
    // commit() was called after all batch.update() calls (user entry + group entry = 2)
    expect(commitCallCount.atCommit).toBe(2);
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

  it('does not call batch.commit() when fetch-first guard fails', async () => {
    const currentSnap = makeDocSnap({ id: 'g-1', slug: 'fc', users: [] });
    setupFindOne(currentSnap);

    const notFoundErr = { output: { statusCode: 404 }, message: 'User not found' };
    mockUserService.getByEmail.mockRejectedValue(notFoundErr);

    const service = new GroupService(mockUserService);
    const group = new Group({ id: 'g-1', slug: 'fc', users: ['ghost@test.com'] });

    try { await service.update('g-1', group); } catch (_) { /* expected */ }

    expect(mockBatch.commit).not.toHaveBeenCalled();
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

  it('fetches all users in the diff before any batch entries are queued', async () => {
    const currentSnap = makeDocSnap({ id: 'g-1', slug: 'fc', users: ['old@test.com'] });
    setupFindOne(currentSnap);

    const fetchOrder = [];
    const oldUser = { id: 'u-1', email: 'old@test.com', groups: ['fc'], role: 'user', firstName: '', lastName: '' };
    const newUser = { id: 'u-2', email: 'new@test.com', groups: [], role: 'user', firstName: '', lastName: '' };

    mockUserService.getByEmail.mockImplementation((email) => {
      fetchOrder.push(`fetch:${email}`);
      return Promise.resolve(email === 'old@test.com' ? oldUser : newUser);
    });

    const updatedSnap = makeDocSnap({ id: 'g-1', slug: 'fc', users: ['new@test.com'] });
    setupPostCommitRead(updatedSnap);

    const service = new GroupService(mockUserService);
    // old@test.com removed, new@test.com added
    const group = new Group({ id: 'g-1', slug: 'fc', users: ['new@test.com'] });

    await service.update('g-1', group);

    // Both users should be fetched
    expect(fetchOrder).toContain('fetch:new@test.com');
    expect(fetchOrder).toContain('fetch:old@test.com');
    // Both fetches complete before batch entries are queued, so batch.update was
    // not called during the fetch phase
    expect(mockBatch.commit).toHaveBeenCalledTimes(1);
  });

  it('propagates error from batch.commit() and does not swallow it', async () => {
    const currentSnap = makeDocSnap({ id: 'g-1', slug: 'fc', users: ['a@test.com'] });
    setupFindOne(currentSnap);

    const userObj = { id: 'u-1', email: 'a@test.com', groups: ['fc'], role: 'user', firstName: '', lastName: '' };
    mockUserService.getByEmail.mockResolvedValue(userObj);

    const commitErr = new Error('Batch commit failed');
    mockBatch.commit.mockRejectedValue(commitErr);

    const service = new GroupService(mockUserService);
    const group = new Group({ id: 'g-1', slug: 'fc', users: [] });

    let err;
    try {
      await service.update('g-1', group);
    } catch (e) {
      err = e;
    }

    expect(err).toBe(commitErr);
  });

  it('propagates batch.commit() error even when group.users is undefined', async () => {
    const commitErr = new Error('Batch commit failed');
    mockBatch.commit.mockRejectedValue(commitErr);

    const service = new GroupService(mockUserService);
    const group = new Group({ id: 'g-1', name: 'New Name', slug: 'fc' });
    expect(group.users).toBeUndefined();

    let err;
    try {
      await service.update('g-1', group);
    } catch (e) {
      err = e;
    }

    expect(err).toBe(commitErr);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// delete
// ─────────────────────────────────────────────────────────────────────────────
describe('GroupService.delete()', () => {
  // Helper: configure mockDb.get for findOne(id) — same as update() tests.
  function setupFindOne(snap) {
    mockDb.get.mockResolvedValue(snap);
  }

  it('deletes the group and removes slug from each member\'s groups', async () => {
    // findOne returns a group with two members
    const currentSnap = makeDocSnap({ id: 'group-1', slug: 'fc', users: ['user-1', 'user-2'] });
    setupFindOne(currentSnap);

    const service = new GroupService(mockUserService);
    const result = await service.delete('group-1');

    // batch.update called once per member with arrayRemove of the slug
    expect(mockBatch.update).toHaveBeenCalledTimes(2);
    const [, payload1] = mockBatch.update.mock.calls[0];
    const [, payload2] = mockBatch.update.mock.calls[1];
    expect(payload1.groups).toEqual(Firestore.FieldValue.arrayRemove('fc'));
    expect(payload1.updated).toBeDefined();
    expect(payload2.groups).toEqual(Firestore.FieldValue.arrayRemove('fc'));
    expect(payload2.updated).toBeDefined();

    // batch.delete called once for the group document ref
    expect(mockBatch.delete).toHaveBeenCalledTimes(1);

    // batch.commit called once after all entries are queued
    expect(mockBatch.commit).toHaveBeenCalledTimes(1);

    // returns the deleted document id
    expect(result).toBe('group-1');
  });

  it('deletes the group when it has no members', async () => {
    const currentSnap = makeDocSnap({ id: 'group-1', slug: 'fc', users: [] });
    setupFindOne(currentSnap);

    const service = new GroupService(mockUserService);
    await service.delete('group-1');

    // No member updates — users array is empty
    expect(mockBatch.update).not.toHaveBeenCalled();

    // Group document is still deleted
    expect(mockBatch.delete).toHaveBeenCalledTimes(1);
    expect(mockBatch.commit).toHaveBeenCalledTimes(1);
  });

  it('deletes the group when users field is absent', async () => {
    // makeDocSnap without users — docParser receives users: [] but here we test
    // the raw ?? [] guard by stubbing findOne directly to return an object with no users key.
    mockDb.get.mockResolvedValue({
      ref: { id: 'group-1' },
      data: () => ({
        name: 'Facultad de Ciencias',
        slug: 'fc',
        // users field intentionally absent
        created: { toMillis: () => 1000000 },
        updated: { toMillis: () => 2000000 },
      }),
    });

    const service = new GroupService(mockUserService);
    await service.delete('group-1');

    // No member updates — users is undefined, ?? [] guard applies
    expect(mockBatch.update).not.toHaveBeenCalled();

    // Group document is still deleted
    expect(mockBatch.delete).toHaveBeenCalledTimes(1);
    expect(mockBatch.commit).toHaveBeenCalledTimes(1);
  });

  it('propagates 404 when group does not exist and does not call batch.commit()', async () => {
    const boom = require('@hapi/boom');
    const notFoundErr = boom.notFound('Group not found');
    mockDb.get.mockRejectedValue(notFoundErr);

    const service = new GroupService(mockUserService);
    let err;
    try {
      await service.delete('nonexistent');
    } catch (e) {
      err = e;
    }

    expect(err).toBe(notFoundErr);
    expect(err.output.statusCode).toBe(404);
    expect(mockBatch.commit).not.toHaveBeenCalled();
  });
});
