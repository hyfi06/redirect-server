const boom = require('@hapi/boom');
const config = require('../../config');
const { errorHandler, wrapErrors } = require('../error.handler');

jest.mock('@hapi/boom');
jest.mock('../../config');

describe('error.handler', () => {
  const mockRes = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    sendFile: jest.fn(),
  };
  const mockNext = jest.fn();

  beforeEach(() => {
    boom.badImplementation.mockReturnValue({
      isBoom: true,
      output: {
        statusCode: 500,
        payload: {},
      },
    });

    boom.notFound.mockReturnValue({
      isBoom: true,
      output: {
        statusCode: 404,
        payload: {},
      },
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('wrapErrors', () => {
    const mockReq = {};

    it('should wrap non-boom errors', () => {
      const mockErr = new Error('test error');
      wrapErrors(mockErr, mockReq, mockRes, mockNext);

      expect(boom.badImplementation).toHaveBeenCalledWith(mockErr);
      expect(mockNext).toHaveBeenCalledWith(boom.badImplementation());
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('should pass through boom errors', () => {
      const mockErr = boom.badImplementation();
      wrapErrors(mockErr, mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(mockErr);
    });
  });

  describe('errorHandler — browser routes', () => {
    const mockReq = { path: '/some-page' };

    it('serves the HTML error page for 500 errors in production', () => {
      config.dev = false;
      const mockErr = boom.badImplementation();
      errorHandler(mockErr, mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.sendFile).toHaveBeenCalled();
      expect(mockRes.json).not.toHaveBeenCalled();
    });

    it('responds with JSON payload and stack for 500 errors in dev mode', () => {
      config.dev = true;
      const mockErr = boom.badImplementation();
      errorHandler(mockErr, mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        ...mockErr.output.payload,
        stack: mockErr.stack,
      });
      expect(mockRes.sendFile).not.toHaveBeenCalled();
    });

    it('returns JSON status and payload without stack for non-500/404 errors in production', () => {
      config.dev = false;
      const mockErr = {
        isBoom: true,
        output: { statusCode: 400, payload: { error: 'Bad Request', message: 'invalid' } },
        stack: 'Error: invalid\n    at ...',
      };
      errorHandler(mockErr, mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Bad Request', message: 'invalid' });
      expect(mockRes.sendFile).not.toHaveBeenCalled();
    });

    it('serves the HTML not-found page for 404 errors', () => {
      const mockErr = boom.notFound();
      errorHandler(mockErr, mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.sendFile).toHaveBeenCalled();
      expect(mockRes.json).not.toHaveBeenCalled();
    });
  });

  describe('errorHandler — API routes', () => {
    const mockReq = { path: '/api/v1/redirects/nonexistent' };

    it('returns JSON Boom payload for 404 errors, not sendFile', () => {
      config.dev = false;
      const mockErr = boom.notFound();
      errorHandler(mockErr, mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith(mockErr.output.payload);
      expect(mockRes.sendFile).not.toHaveBeenCalled();
    });

    it('returns JSON Boom payload for 500 errors in production, not sendFile', () => {
      config.dev = false;
      const mockErr = boom.badImplementation();
      errorHandler(mockErr, mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(mockErr.output.payload);
      expect(mockRes.sendFile).not.toHaveBeenCalled();
    });

    it('returns JSON Boom payload with stack for 500 errors in dev mode', () => {
      config.dev = true;
      const mockErr = { ...boom.badImplementation(), stack: 'Error\n    at ...' };
      errorHandler(mockErr, mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        ...mockErr.output.payload,
        stack: mockErr.stack,
      });
      expect(mockRes.sendFile).not.toHaveBeenCalled();
    });

    it('matches any /api/ prefix sub-path', () => {
      config.dev = false;
      const req = { path: '/api/v2/users' };
      const mockErr = {
        isBoom: true,
        output: { statusCode: 403, payload: { error: 'Forbidden', message: 'not allowed' } },
        stack: 'Error\n    at ...',
      };
      errorHandler(mockErr, req, mockRes, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Forbidden', message: 'not allowed' });
      expect(mockRes.sendFile).not.toHaveBeenCalled();
    });
  });
});
