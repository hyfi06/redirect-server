const boom = require('@hapi/boom');
const { authorize } = require('../authorize.middleware');

jest.mock('@hapi/boom');

describe('authorize middleware', () => {
  let mockNext;
  let mockRes;

  beforeEach(() => {
    mockNext = jest.fn();
    mockRes = {};

    boom.forbidden.mockReturnValue({
      isBoom: true,
      output: { statusCode: 403, payload: { error: 'Forbidden' } },
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('single role', () => {
    it('calls next() with no arguments when req.user.role matches the allowed role', () => {
      const req = { user: { role: 'admin' } };
      const middleware = authorize('admin');

      middleware(req, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('calls next with boom.forbidden when req.user.role does not match', () => {
      const req = { user: { role: 'user' } };
      const middleware = authorize('admin');

      middleware(req, mockRes, mockNext);

      expect(boom.forbidden).toHaveBeenCalledWith('Insufficient permissions');
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockNext).toHaveBeenCalledWith(boom.forbidden());
    });

    it('does not call boom.forbidden when the role matches', () => {
      const req = { user: { role: 'admin' } };
      const middleware = authorize('admin');

      middleware(req, mockRes, mockNext);

      expect(boom.forbidden).not.toHaveBeenCalled();
    });
  });

  describe('multiple roles', () => {
    it('grants access when req.user.role is the first of multiple allowed roles', () => {
      const req = { user: { role: 'admin' } };
      const middleware = authorize('admin', 'editor');

      middleware(req, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
      expect(boom.forbidden).not.toHaveBeenCalled();
    });

    it('grants access when req.user.role is the second of multiple allowed roles', () => {
      const req = { user: { role: 'editor' } };
      const middleware = authorize('admin', 'editor');

      middleware(req, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
      expect(boom.forbidden).not.toHaveBeenCalled();
    });

    it('denies access when req.user.role is not in the allowed roles list', () => {
      const req = { user: { role: 'viewer' } };
      const middleware = authorize('admin', 'editor');

      middleware(req, mockRes, mockNext);

      expect(boom.forbidden).toHaveBeenCalledWith('Insufficient permissions');
      expect(mockNext).toHaveBeenCalledWith(boom.forbidden());
    });
  });

  describe('undefined req.user', () => {
    it('calls next with boom.forbidden when req.user is undefined', () => {
      const req = {};
      const middleware = authorize('admin');

      middleware(req, mockRes, mockNext);

      expect(boom.forbidden).toHaveBeenCalledWith('Insufficient permissions');
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockNext).toHaveBeenCalledWith(boom.forbidden());
    });

    it('does not throw when req.user is undefined', () => {
      const req = {};
      const middleware = authorize('admin');

      expect(() => middleware(req, mockRes, mockNext)).not.toThrow();
    });

    it('calls next with boom.forbidden when req.user is null', () => {
      const req = { user: null };
      const middleware = authorize('admin');

      middleware(req, mockRes, mockNext);

      expect(boom.forbidden).toHaveBeenCalledWith('Insufficient permissions');
      expect(mockNext).toHaveBeenCalledWith(boom.forbidden());
    });
  });

  describe('factory returns a new middleware per invocation', () => {
    it('returns a function', () => {
      expect(typeof authorize('admin')).toBe('function');
    });

    it('each call to authorize() produces an independent middleware', () => {
      const adminOnly = authorize('admin');
      const editorOnly = authorize('editor');

      const adminReq = { user: { role: 'admin' } };
      const editorReq = { user: { role: 'editor' } };
      const adminNext = jest.fn();
      const editorNext = jest.fn();

      adminOnly(adminReq, mockRes, adminNext);
      editorOnly(editorReq, mockRes, editorNext);

      expect(adminNext).toHaveBeenCalledWith();
      expect(editorNext).toHaveBeenCalledWith();
    });
  });
});
