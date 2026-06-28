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

  beforeEach(() => {
    mockUpdate = jest.fn().mockResolvedValue(undefined);
    mockDoc = jest.fn().mockReturnValue({ update: mockUpdate });
    mockCollection = jest.fn().mockReturnValue({ doc: mockDoc });
  });

  afterEach(() => jest.clearAllMocks());

  /**
   * Load a fresh module instance so the singleton counters Map starts empty.
   * jest.isolateModules gives each call its own module registry, which means
   * the module-level `counters` Map is re-initialised on every call.
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
      jest.doMock('../logger', () => ({ log: jest.fn() }));
      mod = require('../click-counter');
    });
    return mod;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // increment
  // ─────────────────────────────────────────────────────────────────────────────

  describe('increment', () => {
    it('below the threshold (9 calls) does not write to Firestore', () => {
      const { increment, getCounters } = loadModule();

      for (let i = 0; i < 9; i++) increment('redirect-1');

      expect(mockUpdate).not.toHaveBeenCalled();
      expect(getCounters().get('redirect-1')).toBe(9);
    });

    it('at the threshold (10th call) flushes FieldValue.increment(N) to Firestore and resets the counter to 0', async () => {
      const { increment, getCounters } = loadModule();

      for (let i = 0; i < 10; i++) increment('redirect-1');

      // _writeCounters is fire-and-forget; flush pending microtasks so any
      // async work that might have deferred is also complete before asserting.
      await Promise.resolve();

      expect(mockCollection).toHaveBeenCalledWith('redirects');
      expect(mockDoc).toHaveBeenCalledWith('redirect-1');
      expect(mockUpdate).toHaveBeenCalledWith({
        clickCount: Firestore.FieldValue.increment(10),
      });
      expect(getCounters().has('redirect-1')).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // flushAll
  // ─────────────────────────────────────────────────────────────────────────────

  describe('flushAll', () => {
    it('writes all pending counters to Firestore with one FieldValue.increment call per redirect', async () => {
      const { increment, flushAll, getCounters } = loadModule();

      increment('r1');
      increment('r1');
      increment('r2');

      await flushAll();

      expect(mockUpdate).toHaveBeenCalledTimes(2);
      expect(mockUpdate).toHaveBeenCalledWith({
        clickCount: Firestore.FieldValue.increment(2),
      });
      expect(mockUpdate).toHaveBeenCalledWith({
        clickCount: Firestore.FieldValue.increment(1),
      });
      expect(getCounters().size).toBe(0);
    });

    it('on an empty map is a no-op and does not call Firestore', async () => {
      const { flushAll } = loadModule();

      await flushAll();

      expect(mockCollection).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });
});
