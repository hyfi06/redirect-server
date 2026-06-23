/**
 * Unit tests for MembershipService.
 *
 * Strategy:
 * - firestoreClient (singleton from src/lib/firestore-client.js) is mocked so
 *   batch() and collection() are controllable without a real Firestore connection.
 * - groupService is injected via constructor as a plain object with jest.fn() methods.
 * - @google-cloud/firestore is auto-mocked so Firestore.Timestamp.fromMillis() and
 *   Firestore.FieldValue.arrayRemove() are no-ops — their return values are passed to
 *   the mocked batch and never reach real Firestore.
 * - boom is NOT mocked — MembershipService does not produce boom errors directly.
 */

jest.mock('@google-cloud/firestore');
jest.mock('../../../../lib/firestore-client');

const Firestore = require('@google-cloud/firestore');
const firestoreClient = require('../../../../lib/firestore-client');
const MembershipService = require('../membership.service');

// ---- Shared mock batch ----
let mockBatch;

// ---- Shared mock groupService ----
let mockGroupService;

// ---- Shared DocumentReference mock ----
let mockGroupRef;

beforeEach(() => {
  // Timestamp and FieldValue stubs — values are opaque in these tests; shape is all that matters.
  Firestore.Timestamp = { fromMillis: jest.fn().mockReturnValue({ _seconds: 0 }) };
  Firestore.FieldValue = { arrayRemove: jest.fn().mockImplementation((v) => ({ _arrayRemove: v })) };

  // Batch mock
  mockBatch = {
    update: jest.fn(),
    commit: jest.fn().mockResolvedValue(undefined),
  };

  // DocumentReference mock — an opaque ref passed to batch.update()
  mockGroupRef = {};

  // firestoreClient singleton mock
  firestoreClient.batch = jest.fn().mockReturnValue(mockBatch);
  firestoreClient.collection = jest.fn().mockReturnValue({
    doc: jest.fn().mockReturnValue(mockGroupRef),
  });

  // groupService mock — injected dependency
  mockGroupService = {
    getBySlug: jest.fn(),
  };
});

afterEach(() => jest.clearAllMocks());

// ─────────────────────────────────────────────────────────────────────────────
// removeUserFromAllGroups
// ─────────────────────────────────────────────────────────────────────────────
describe('MembershipService.removeUserFromAllGroups()', () => {
  it('returns immediately when userGroups is an empty array', async () => {
    const service = new MembershipService({}, mockGroupService);
    await service.removeUserFromAllGroups('user-1', []);

    expect(mockGroupService.getBySlug).not.toHaveBeenCalled();
    expect(firestoreClient.batch).not.toHaveBeenCalled();
  });

  it('returns immediately when userGroups is undefined', async () => {
    const service = new MembershipService({}, mockGroupService);
    await service.removeUserFromAllGroups('user-1', undefined);

    expect(mockGroupService.getBySlug).not.toHaveBeenCalled();
    expect(firestoreClient.batch).not.toHaveBeenCalled();
  });

  it('removes userId from each group in userGroups via a WriteBatch', async () => {
    // getBySlug returns distinct groups for 'fc' and 'cs'
    mockGroupService.getBySlug.mockImplementation((slug) => {
      if (slug === 'fc') return Promise.resolve({ id: 'group-id-1', slug: 'fc' });
      if (slug === 'cs') return Promise.resolve({ id: 'group-id-2', slug: 'cs' });
      return Promise.reject(new Error(`Unexpected slug: ${slug}`));
    });

    const service = new MembershipService({}, mockGroupService);
    await service.removeUserFromAllGroups('user-1', ['fc', 'cs']);

    // getBySlug called once per slug
    expect(mockGroupService.getBySlug).toHaveBeenCalledTimes(2);
    expect(mockGroupService.getBySlug).toHaveBeenCalledWith('fc');
    expect(mockGroupService.getBySlug).toHaveBeenCalledWith('cs');

    // batch.update called once per group with arrayRemove of userId
    expect(mockBatch.update).toHaveBeenCalledTimes(2);
    const [, payload1] = mockBatch.update.mock.calls[0];
    const [, payload2] = mockBatch.update.mock.calls[1];
    expect(payload1.users).toEqual(Firestore.FieldValue.arrayRemove('user-1'));
    expect(payload1.updated).toBeDefined();
    expect(payload2.users).toEqual(Firestore.FieldValue.arrayRemove('user-1'));
    expect(payload2.updated).toBeDefined();

    // batch.commit called exactly once after all entries are queued
    expect(mockBatch.commit).toHaveBeenCalledTimes(1);
  });

  it('passes the correct group doc ref to batch.update for each slug', async () => {
    // Use distinct ref objects per group to verify the correct ref is used
    const fcRef = { _id: 'group-id-1' };
    const csRef = { _id: 'group-id-2' };

    mockGroupService.getBySlug.mockImplementation((slug) => {
      if (slug === 'fc') return Promise.resolve({ id: 'group-id-1', slug: 'fc' });
      if (slug === 'cs') return Promise.resolve({ id: 'group-id-2', slug: 'cs' });
    });

    // Make collection().doc() return slug-specific refs
    firestoreClient.collection.mockReturnValue({
      doc: jest.fn().mockImplementation((docId) => {
        if (docId === 'group-id-1') return fcRef;
        if (docId === 'group-id-2') return csRef;
        return {};
      }),
    });

    const service = new MembershipService({}, mockGroupService);
    await service.removeUserFromAllGroups('user-1', ['fc', 'cs']);

    const [ref1] = mockBatch.update.mock.calls[0];
    const [ref2] = mockBatch.update.mock.calls[1];
    expect(ref1).toBe(fcRef);
    expect(ref2).toBe(csRef);
  });

  it('calls batch.commit() only once regardless of the number of groups', async () => {
    mockGroupService.getBySlug.mockImplementation((slug) =>
      Promise.resolve({ id: `group-id-${slug}`, slug })
    );

    const service = new MembershipService({}, mockGroupService);
    await service.removeUserFromAllGroups('user-1', ['fc', 'cs', 'eng']);

    expect(mockBatch.commit).toHaveBeenCalledTimes(1);
    expect(mockBatch.update).toHaveBeenCalledTimes(3);
  });

  it('propagates errors from groupService.getBySlug without calling batch.commit()', async () => {
    const boom = require('@hapi/boom');
    const notFoundErr = boom.notFound('Group not found');
    mockGroupService.getBySlug.mockRejectedValue(notFoundErr);

    const service = new MembershipService({}, mockGroupService);
    let err;
    try {
      await service.removeUserFromAllGroups('user-1', ['nonexistent']);
    } catch (e) {
      err = e;
    }

    expect(err).toBe(notFoundErr);
    expect(mockBatch.commit).not.toHaveBeenCalled();
  });
});
