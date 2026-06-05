const Joi = require('joi');
const boom = require('@hapi/boom');
const validatorHandler = require('../validator.handler');

jest.mock('@hapi/boom');

describe('validatorHandler', () => {
  const mockRes = {};
  let mockNext;

  const schema = Joi.object({
    name: Joi.string().required(),
    age: Joi.number().integer().min(0),
  });

  beforeEach(() => {
    mockNext = jest.fn();
    boom.badRequest.mockReturnValue({
      isBoom: true,
      output: { statusCode: 400, payload: { error: 'Bad Request' } },
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('valid data', () => {
    it('calls next() once with no arguments when data is valid', async () => {
      const req = { body: { name: 'Alice', age: 30 } };
      const middleware = validatorHandler(schema, 'body');

      await middleware(req, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('does not call boom.badRequest when data is valid', async () => {
      const req = { body: { name: 'Alice' } };
      const middleware = validatorHandler(schema, 'body');

      await middleware(req, mockRes, mockNext);

      expect(boom.badRequest).not.toHaveBeenCalled();
    });
  });

  describe('invalid data', () => {
    it('calls next() exactly once when validation fails (no double-next)', async () => {
      const req = { body: {} };
      const middleware = validatorHandler(schema, 'body');

      await middleware(req, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('calls next() with a boom.badRequest error when validation fails', async () => {
      const req = { body: {} };
      const middleware = validatorHandler(schema, 'body');

      await middleware(req, mockRes, mockNext);

      expect(boom.badRequest).toHaveBeenCalledTimes(1);
      expect(mockNext).toHaveBeenCalledWith(boom.badRequest());
    });

    it('passes the Joi error to boom.badRequest', async () => {
      const req = { body: { name: 123 } };
      const middleware = validatorHandler(schema, 'body');

      await middleware(req, mockRes, mockNext);

      const joiError = boom.badRequest.mock.calls[0][0];
      expect(joiError).toBeInstanceOf(Joi.ValidationError);
    });

    it('collects all validation errors (abortEarly: false)', async () => {
      const req = { body: { age: -1 } };
      const middleware = validatorHandler(schema, 'body');

      await middleware(req, mockRes, mockNext);

      const joiError = boom.badRequest.mock.calls[0][0];
      expect(joiError.details.length).toBeGreaterThan(1);
    });
  });

  describe('property targeting', () => {
    it('reads from req.query when property is "query"', async () => {
      const req = { query: { name: 'Bob' } };
      const middleware = validatorHandler(schema, 'query');

      await middleware(req, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
      expect(boom.badRequest).not.toHaveBeenCalled();
    });

    it('reads from req.params when property is "params"', async () => {
      const req = { params: {} };
      const middleware = validatorHandler(schema, 'params');

      await middleware(req, mockRes, mockNext);

      expect(boom.badRequest).toHaveBeenCalledTimes(1);
    });

    it('reads from req.body when property is "body"', async () => {
      const req = { body: { name: 'Carol' } };
      const middleware = validatorHandler(schema, 'body');

      await middleware(req, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });
  });
});
