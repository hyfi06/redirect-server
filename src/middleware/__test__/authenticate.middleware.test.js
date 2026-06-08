const boom = require('@hapi/boom');
const { authenticate } = require('../authenticate.middleware');

jest.mock('@hapi/boom');
jest.mock('../../utils/auth/jwt');

const jwt = require('../../utils/auth/jwt');

describe('authenticate middleware', () => {
  let mockNext;
  let mockRes;

  beforeEach(() => {
    mockNext = jest.fn();
    mockRes = {};

    boom.unauthorized.mockReturnValue({
      isBoom: true,
      output: { statusCode: 401, payload: { error: 'Unauthorized' } },
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('missing or malformed Authorization header', () => {
    it('calls next with boom.unauthorized when Authorization header is absent', () => {
      const req = { headers: {} };

      authenticate(req, mockRes, mockNext);

      expect(boom.unauthorized).toHaveBeenCalledWith('Missing token');
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockNext).toHaveBeenCalledWith(boom.unauthorized());
    });

    it('calls next with boom.unauthorized when header does not start with "Bearer "', () => {
      const req = { headers: { authorization: 'Basic dXNlcjpwYXNz' } };

      authenticate(req, mockRes, mockNext);

      expect(boom.unauthorized).toHaveBeenCalledWith('Missing token');
      expect(mockNext).toHaveBeenCalledWith(boom.unauthorized());
    });

    it('calls next with boom.unauthorized when header is the bare string "Bearer" without a space', () => {
      const req = { headers: { authorization: 'Bearer' } };

      authenticate(req, mockRes, mockNext);

      expect(boom.unauthorized).toHaveBeenCalledWith('Missing token');
      expect(mockNext).toHaveBeenCalledWith(boom.unauthorized());
    });

    it('does not call jwt.verify when the header is missing', () => {
      const req = { headers: {} };

      authenticate(req, mockRes, mockNext);

      expect(jwt.verify).not.toHaveBeenCalled();
    });
  });

  describe('valid token', () => {
    it('sets req.user to the decoded payload and calls next() with no arguments', () => {
      const payload = { id: 'user-1', role: 'admin' };
      jwt.verify.mockReturnValue(payload);
      const req = { headers: { authorization: 'Bearer valid.token.here' } };

      authenticate(req, mockRes, mockNext);

      expect(jwt.verify).toHaveBeenCalledWith('valid.token.here');
      expect(req.user).toBe(payload);
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('strips exactly the "Bearer " prefix (7 chars) before passing the token to verify', () => {
      jwt.verify.mockReturnValue({ id: 'user-1' });
      const rawToken = 'abc.def.ghi';
      const req = { headers: { authorization: `Bearer ${rawToken}` } };

      authenticate(req, mockRes, mockNext);

      expect(jwt.verify).toHaveBeenCalledWith(rawToken);
    });

    it('does not call boom.unauthorized when the token is valid', () => {
      jwt.verify.mockReturnValue({ id: 'user-1' });
      const req = { headers: { authorization: 'Bearer valid.token' } };

      authenticate(req, mockRes, mockNext);

      expect(boom.unauthorized).not.toHaveBeenCalled();
    });
  });

  describe('invalid or expired token', () => {
    it('calls next with boom.unauthorized when jwt.verify throws', () => {
      jwt.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });
      const req = { headers: { authorization: 'Bearer expired.token' } };

      authenticate(req, mockRes, mockNext);

      expect(boom.unauthorized).toHaveBeenCalledWith('Invalid token');
      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockNext).toHaveBeenCalledWith(boom.unauthorized());
    });

    it('does not set req.user when jwt.verify throws', () => {
      jwt.verify.mockImplementation(() => {
        throw new Error('invalid signature');
      });
      const req = { headers: { authorization: 'Bearer tampered.token' } };

      authenticate(req, mockRes, mockNext);

      expect(req.user).toBeUndefined();
    });

    it('calls next exactly once when the token is invalid', () => {
      jwt.verify.mockImplementation(() => {
        throw new Error('jwt malformed');
      });
      const req = { headers: { authorization: 'Bearer bad.token' } };

      authenticate(req, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
    });
  });
});
