'use strict';

// Mock @google-cloud/firestore so FieldValue.increment returns a plain object
// that jest can compare with toEqual — Firestore's private sentinel type does
// not implement structural equality and would fail toHaveBeenCalledWith checks.
jest.mock('@google-cloud/firestore', () => ({
  FieldValue: {
    increment: jest.fn((n) => ({ __increment: n })),
  },
}));

const Firestore = require('@google-cloud/firestore');

describe('click-counter', () => {
  let mockUpdate;
  let mockDoc;
  let mockCollection;
  let mockLog;

  beforeEach(() => {
    mockUpdate = jest.fn().mockResolvedValue(undefined);
    mockDoc = jest.fn().mockReturnValue({ update: mockUpdate });
    mockCollection = jest.fn().mockReturnValue({ doc: mockDoc });
    mockLog = jest.fn();
  });

  afterEach(() => jest.clearAllMocks());

  /**
   * Load a fresh module instance per test so mocks are wired freshly each time.
   * jest.isolateModules gives each call its own module registry.
   */
  function loadModule() {
    let mod;
    jest.isolateModules(() => {
      jest.doMock('../../lib/firestore-client', () => ({
        collection: mockCollection,
      }));
      jest.doMock('../../config', () => ({
        firestore: { collections: { redirects: 'redirects' } },
      }));
      jest.doMock('../logger', () => ({ log: mockLog }));
      mod = require('../click-counter');
    });
    return mod;
  }

  // Flushes pending microtasks so a fire-and-forget promise chain (the
  // .catch() attached inside increment) has a chance to settle before
  // assertions run.
  function flushMicrotasks() {
    return new Promise((resolve) => setImmediate(resolve));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // increment
  // ─────────────────────────────────────────────────────────────────────────────

  describe('increment', () => {
    it('writes FieldValue.increment(1) directly to the redirect document', () => {
      const { increment } = loadModule();

      increment('redirect-1');

      expect(mockCollection).toHaveBeenCalledWith('redirects');
      expect(mockDoc).toHaveBeenCalledWith('redirect-1');
      expect(mockUpdate).toHaveBeenCalledWith({
        clickCount: Firestore.FieldValue.increment(1),
      });
    });

    it('issues one independent Firestore write per call, with no accumulation', () => {
      const { increment } = loadModule();

      increment('redirect-1');
      increment('redirect-1');
      increment('redirect-1');

      expect(mockUpdate).toHaveBeenCalledTimes(3);
      // Every call increments by 1 — never a batched total — because each
      // call is a standalone write with no in-memory counter behind it.
      mockUpdate.mock.calls.forEach((call) => {
        expect(call[0]).toEqual({ clickCount: Firestore.FieldValue.increment(1) });
      });
    });

    it('does not throw, and logs the error, when the Firestore write rejects', async () => {
      mockUpdate = jest.fn().mockRejectedValue(new Error('firestore unavailable'));
      mockDoc = jest.fn().mockReturnValue({ update: mockUpdate });
      mockCollection = jest.fn().mockReturnValue({ doc: mockDoc });
      const { increment } = loadModule();

      expect(() => increment('redirect-1')).not.toThrow();

      await flushMicrotasks();

      expect(mockLog).toHaveBeenCalledWith(
        'ERROR',
        'click-counter: Firestore write failed',
        expect.objectContaining({ error: 'firestore unavailable' }),
      );
    });
  });
});
