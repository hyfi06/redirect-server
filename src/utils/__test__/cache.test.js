const NodeCache = require('node-cache');

describe('cache utils', () => {
  describe('nodeCache singleton', () => {
    it('exposes a get method', () => {
      const { nodeCache } = require('../cache');
      expect(typeof nodeCache.get).toBe('function');
    });

    it('exposes a set method', () => {
      const { nodeCache } = require('../cache');
      expect(typeof nodeCache.set).toBe('function');
    });

    it('exposes a has method', () => {
      const { nodeCache } = require('../cache');
      expect(typeof nodeCache.has).toBe('function');
    });

    it('is an instance of NodeCache', () => {
      const { nodeCache } = require('../cache');
      expect(nodeCache).toBeInstanceOf(NodeCache);
    });
  });

  describe('setClientCache', () => {
    let mockRes;

    beforeEach(() => {
      mockRes = { set: jest.fn() };
      jest.resetModules();
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    it('sets Cache-Control header with correct value in production', () => {
      jest.mock('../../config', () => ({ dev: false }));
      const { setClientCache } = require('../cache');

      setClientCache(mockRes, 300);

      expect(mockRes.set).toHaveBeenCalledWith('Cache-Control', 'public, max-age=300');
    });

    it('does not set Cache-Control header in development', () => {
      jest.mock('../../config', () => ({ dev: true }));
      const { setClientCache } = require('../cache');

      setClientCache(mockRes, 300);

      expect(mockRes.set).not.toHaveBeenCalled();
    });

    it('does not set Cache-Control header in test environment', () => {
      jest.mock('../../config', () => ({ dev: true }));
      const { setClientCache } = require('../cache');

      setClientCache(mockRes, 1800);

      expect(mockRes.set).not.toHaveBeenCalled();
    });

    it('uses the provided ttl value in the header', () => {
      jest.mock('../../config', () => ({ dev: false }));
      const { setClientCache } = require('../cache');

      setClientCache(mockRes, 1800);

      expect(mockRes.set).toHaveBeenCalledWith('Cache-Control', 'public, max-age=1800');
    });
  });
});
