const boom = require('@hapi/boom');
const notFoundHandler = require('../notFoundHandler');

jest.mock('@hapi/boom');

describe('notFoundHandler', () => {
  const mockReq = {};
  const mockRes = {};
  const mockNext = jest.fn();

  beforeEach(() => {
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

  it('should call next with a not found error', () => {
    notFoundHandler(mockReq, mockRes, mockNext);

    expect(boom.notFound).toHaveBeenCalledWith('Route not found');
    expect(mockNext).toHaveBeenCalledWith(boom.notFound('Route not found'));
  });
});
