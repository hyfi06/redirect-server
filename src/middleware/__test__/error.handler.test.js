const boom = require('@hapi/boom');
const config = require('../../config');
const { errorHandler, wrapErrors } = require('../error.handler');

jest.mock('@hapi/boom');
jest.mock('../../config');

describe('error.handler', () => {
  const mockReq = {};
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

  it('should wrap non-boom errors', () => {
    const mockErr = new Error('test error');
    wrapErrors(mockErr, mockReq, mockRes, mockNext);

    expect(boom.badImplementation).toHaveBeenCalledWith(mockErr);
    expect(mockNext).toHaveBeenCalledWith(boom.badImplementation());
  });

  it('should pass through boom errors', () => {
    const mockErr = boom.badImplementation();
    wrapErrors(mockErr, mockReq, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalledWith(mockErr);
  });

  it('should respond with status code and payload', () => {
    config.dev = false;
    const mockErr = boom.badImplementation();
    errorHandler(mockErr, mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith({
      ...mockErr.output.payload,
    });
  });

  it('should respond with status code and payload with stack in dev mode', () => {
    config.dev = true;
    const mockErr = boom.badImplementation();
    errorHandler(mockErr, mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith({
      ...mockErr.output.payload,
      stack: mockErr.stack,
    });
  });

  it('should respond with not found page for 404 status code', () => {
    const mockErr = boom.notFound();
    errorHandler(mockErr, mockReq, mockRes, mockNext);

    expect(mockRes.sendFile).toHaveBeenCalled();
  });
});
