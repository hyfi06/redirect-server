'use strict';

/**
 * Unit tests for RedirectServiceApi.
 *
 * Strategy:
 * - FireStoreAdapter is fully mocked — the mock constructor returns a shared
 *   mockDb object that test bodies configure per-test.
 * - boom is NOT mocked — RedirectServiceApi throws real boom objects; tests
 *   inspect e.output.statusCode to verify error semantics.
 * - create() rethrows any non-404 error from getByPath (the guard at line 44
 *   of the source: `if (e.output?.statusCode !== 404) throw e`), so a raw
 *   Firestore error surfaces to the caller rather than being swallowed.
 */

jest.mock('@google-cloud/firestore');
jest.mock('../../../../lib/firestore');
jest.mock('../../../../config', () => ({
  firestore: { collections: { redirects: 'redirects' } },
}));

const FireStoreAdapter = require('../../../../lib/firestore');
const RedirectServiceApi = require('../redirect.service.api');

// ─────────────────────────────────────────────────────────────────────────────
// Shared mock db + helpers
// ─────────────────────────────────────────────────────────────────────────────

let mockDb;

function makeDocSnap({
  id = 'r-1',
  path = '/fc/test',
  url = 'https://example.com',
  owner = 'a@test.com',
  permission = [],
  categories = [],
} = {}) {
  return {
    ref: { id },
    data: () => ({
      path,
      url,
      owner,
      permission,
      categories,
      created: { toMillis: () => 1000000 },
      updated: { toMillis: () => 2000000 },
    }),
  };
}

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
});

afterEach(() => jest.clearAllMocks());

// ─────────────────────────────────────────────────────────────────────────────
// getByPath
// ─────────────────────────────────────────────────────────────────────────────

describe('RedirectServiceApi.getByPath()', () => {
  it('returns the parsed Redirect when Firestore returns a matching document', async () => {
    const docSnap = makeDocSnap({ id: 'r-1', path: '/fc/test' });
    mockDb.collection.get.mockResolvedValue(makeQuerySnap([docSnap]));

    const service = new RedirectServiceApi();
    const result = await service.getByPath('/fc/test');

    expect(result).toMatchObject({ id: 'r-1', path: '/fc/test' });
  });

  it('queries Firestore with where("path", "==", path)', async () => {
    const docSnap = makeDocSnap({ path: '/fc/test' });
    mockDb.collection.get.mockResolvedValue(makeQuerySnap([docSnap]));

    const service = new RedirectServiceApi();
    await service.getByPath('/fc/test');

    expect(mockDb.collection.where).toHaveBeenCalledWith('path', '==', '/fc/test');
  });

  it('throws boom 404 when the query snapshot is empty', async () => {
    mockDb.collection.get.mockResolvedValue(makeQuerySnap([]));

    const service = new RedirectServiceApi();
    let err;
    try {
      await service.getByPath('/fc/does-not-exist');
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.output.statusCode).toBe(404);
  });

  it('surfaces the 404 message "Resource not found"', async () => {
    mockDb.collection.get.mockResolvedValue(makeQuerySnap([]));

    const service = new RedirectServiceApi();
    let err;
    try {
      await service.getByPath('/fc/does-not-exist');
    } catch (e) {
      err = e;
    }
    expect(err.message).toBe('Resource not found');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// create
// ─────────────────────────────────────────────────────────────────────────────

describe('RedirectServiceApi.create()', () => {
  it('creates and returns the new redirect when the path does not exist yet', async () => {
    // getByPath → empty snapshot → throws 404 → caught → db.create runs
    mockDb.collection.get.mockResolvedValue(makeQuerySnap([]));
    const createdSnap = makeDocSnap({ id: 'new-r', path: '/fc/new' });
    mockDb.create.mockResolvedValue(createdSnap);

    const service = new RedirectServiceApi();
    const redirect = { path: '/fc/new', url: 'https://example.com', owner: 'a@test.com' };
    const result = await service.create(redirect);

    expect(result).toMatchObject({ id: 'new-r', path: '/fc/new' });
  });

  it('calls db.create exactly once when the path does not exist', async () => {
    mockDb.collection.get.mockResolvedValue(makeQuerySnap([]));
    const createdSnap = makeDocSnap({ id: 'new-r', path: '/fc/new' });
    mockDb.create.mockResolvedValue(createdSnap);

    const service = new RedirectServiceApi();
    await service.create({ path: '/fc/new', url: 'https://example.com', owner: 'a@test.com' });

    expect(mockDb.create).toHaveBeenCalledTimes(1);
  });

  it('throws boom 400 "Path already taken" when the path already exists', async () => {
    // getByPath resolves (path found) → create() throws badRequest
    const existingSnap = makeDocSnap({ path: '/fc/taken' });
    mockDb.collection.get.mockResolvedValue(makeQuerySnap([existingSnap]));

    const service = new RedirectServiceApi();
    let err;
    try {
      await service.create({ path: '/fc/taken', url: 'https://example.com', owner: 'a@test.com' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.output.statusCode).toBe(400);
    expect(err.message).toBe('Path already taken');
  });

  it('does not call db.create when the path already exists', async () => {
    const existingSnap = makeDocSnap({ path: '/fc/taken' });
    mockDb.collection.get.mockResolvedValue(makeQuerySnap([existingSnap]));

    const service = new RedirectServiceApi();
    try {
      await service.create({ path: '/fc/taken', url: 'https://example.com', owner: 'a@test.com' });
    } catch (_) { /* expected */ }

    expect(mockDb.create).not.toHaveBeenCalled();
  });

  it('strips trailing slash from path before checking for duplicates', async () => {
    mockDb.collection.get.mockResolvedValue(makeQuerySnap([]));
    const createdSnap = makeDocSnap({ id: 'new-r', path: '/fc/new' });
    mockDb.create.mockResolvedValue(createdSnap);

    const service = new RedirectServiceApi();
    await service.create({ path: '/fc/new/', url: 'https://example.com', owner: 'a@test.com' });

    // getByPath must be called with the slash-stripped path
    expect(mockDb.collection.where).toHaveBeenCalledWith('path', '==', '/fc/new');
  });

  it('rethrows a non-404 Firestore error from getByPath without calling db.create', async () => {
    // Simulate a Firestore-level failure (e.g., network error) during the lookup.
    // The guard `if (e.output?.statusCode !== 404) throw e` ensures non-404
    // errors are rethrown. A plain Error has no .output, so it is always rethrown.
    const firestoreError = new Error('Firestore connection refused');
    mockDb.collection.get.mockRejectedValue(firestoreError);

    const service = new RedirectServiceApi();
    let err;
    try {
      await service.create({ path: '/fc/new', url: 'https://example.com', owner: 'a@test.com' });
    } catch (e) {
      err = e;
    }

    expect(err).toBe(firestoreError);
    expect(mockDb.create).not.toHaveBeenCalled();
  });
});
