'use strict';

jest.mock('../../lib/firestore');
const FireStoreAdapter = require('../../lib/firestore');
const CrudService = require('../crud.service');

// ──────────────────────────────────────────────────────────────────────────────
// Shared mock setup
// ──────────────────────────────────────────────────────────────────────────────

let mockDb;

beforeEach(() => {
  mockDb = {
    get: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    collection: {
      where: jest.fn().mockReturnThis(),
      get: jest.fn(),
      orderBy: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
    },
  };
  FireStoreAdapter.mockImplementation(() => mockDb);
});

afterEach(() => jest.clearAllMocks());

// ──────────────────────────────────────────────────────────────────────────────
// Constructor
// ──────────────────────────────────────────────────────────────────────────────

describe('CrudService — constructor', () => {
  it('uses identity functions when no parsers are provided', () => {
    const service = new CrudService('items');

    const sentinel = { x: 1 };
    expect(service.docParser(sentinel)).toBe(sentinel);
    expect(service.createParser(sentinel)).toBe(sentinel);
    expect(service.updateParser(sentinel)).toBe(sentinel);
  });

  it('stores the provided parsers', () => {
    const docParser = jest.fn((o) => ({ ...o, parsed: true }));
    const createParser = jest.fn((o) => ({ ...o, created: true }));
    const updateParser = jest.fn((o) => ({ ...o, updated: true }));

    const service = new CrudService('items', docParser, createParser, updateParser);

    expect(service.docParser).toBe(docParser);
    expect(service.createParser).toBe(createParser);
    expect(service.updateParser).toBe(updateParser);
  });

  it('instantiates FireStoreAdapter with the given collection name', () => {
    new CrudService('my-table');

    expect(FireStoreAdapter).toHaveBeenCalledWith('my-table');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// create(data)
// ──────────────────────────────────────────────────────────────────────────────

describe('CrudService — create()', () => {
  it('passes createParser(data) to db.create', async () => {
    const createParser = jest.fn((o) => ({ ...o, extra: true }));
    const service = new CrudService('items', undefined, createParser);
    const rawDoc = { id: '1', name: 'test' };
    mockDb.create.mockResolvedValue(rawDoc);

    await service.create({ name: 'test' });

    expect(mockDb.create).toHaveBeenCalledWith({ name: 'test', extra: true });
  });

  it('returns docParser applied to the new document', async () => {
    const docParser = jest.fn((o) => ({ ...o, fromFirestore: true }));
    const service = new CrudService('items', docParser);
    const rawDoc = { id: '1', name: 'test' };
    mockDb.create.mockResolvedValue(rawDoc);

    const result = await service.create({ name: 'test' });

    expect(result).toEqual({ id: '1', name: 'test', fromFirestore: true });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// getAll(options)
// ──────────────────────────────────────────────────────────────────────────────

describe('CrudService — getAll()', () => {
  let service;

  beforeEach(() => {
    service = new CrudService('items');
    mockDb.collection.get.mockResolvedValue({ empty: true, docs: [] });
  });

  it("defaults to orderBy('updated', 'desc') when no orderBy is given", async () => {
    await service.getAll({});

    expect(mockDb.collection.orderBy).toHaveBeenCalledWith('updated', 'desc');
  });

  it('applies ascending orderBy when the field has no leading dash', async () => {
    await service.getAll({ orderBy: 'name' });

    expect(mockDb.collection.orderBy).toHaveBeenCalledWith('name');
    expect(mockDb.collection.orderBy).not.toHaveBeenCalledWith('name', 'desc');
  });

  it("applies descending orderBy when the field has a leading '-'", async () => {
    await service.getAll({ orderBy: '-name' });

    expect(mockDb.collection.orderBy).toHaveBeenCalledWith('name', 'desc');
  });

  it('applies offset when provided', async () => {
    await service.getAll({ offset: 10 });

    expect(mockDb.collection.offset).toHaveBeenCalledWith(10);
  });

  it('applies limit when provided', async () => {
    await service.getAll({ limit: 5 });

    expect(mockDb.collection.limit).toHaveBeenCalledWith(5);
  });

  it('returns [] when the snapshot is empty', async () => {
    mockDb.collection.get.mockResolvedValue({ empty: true, docs: [] });

    const result = await service.getAll({});

    expect(result).toEqual([]);
  });

  it('returns documents mapped through docParser when snapshot is non-empty', async () => {
    const docParser = jest.fn((doc) => ({ id: doc.id, name: doc.data().name }));
    service = new CrudService('items', docParser);
    const fakeDocs = [
      { id: 'a', data: () => ({ name: 'alpha' }) },
      { id: 'b', data: () => ({ name: 'beta' }) },
    ];
    mockDb.collection.get.mockResolvedValue({ empty: false, docs: fakeDocs });

    const result = await service.getAll({});

    expect(result).toEqual([
      { id: 'a', name: 'alpha' },
      { id: 'b', name: 'beta' },
    ]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// find(query, options)
// ──────────────────────────────────────────────────────────────────────────────

describe('CrudService — find()', () => {
  let service;

  beforeEach(() => {
    service = new CrudService('items');
    mockDb.collection.get.mockResolvedValue({ empty: true, docs: [] });
  });

  it('calls where(...query) when a query is provided', async () => {
    await service.find(['status', '==', 'active'], {});

    expect(mockDb.collection.where).toHaveBeenCalledWith('status', '==', 'active');
  });

  it("defaults to orderBy('updated', 'desc') when query is null and no orderBy option", async () => {
    await service.find(null, {});

    expect(mockDb.collection.orderBy).toHaveBeenCalledWith('updated', 'desc');
  });

  it('does not apply the default orderBy when query is null but orderBy option is set', async () => {
    await service.find(null, { orderBy: 'name' });

    // The first orderBy call should be for 'name', not 'updated'
    expect(mockDb.collection.orderBy).not.toHaveBeenCalledWith('updated', 'desc');
    expect(mockDb.collection.orderBy).toHaveBeenCalledWith('name', 'asc');
  });

  it("applies ascending orderBy(field, 'asc') when no leading dash", async () => {
    await service.find(null, { orderBy: 'created' });

    expect(mockDb.collection.orderBy).toHaveBeenCalledWith('created', 'asc');
  });

  it("applies descending orderBy(field, 'desc') when field has a leading '-'", async () => {
    await service.find(null, { orderBy: '-created' });

    expect(mockDb.collection.orderBy).toHaveBeenCalledWith('created', 'desc');
  });

  it('applies offset when provided', async () => {
    await service.find(null, { offset: 20 });

    expect(mockDb.collection.offset).toHaveBeenCalledWith(20);
  });

  it('applies limit when provided', async () => {
    await service.find(null, { limit: 3 });

    expect(mockDb.collection.limit).toHaveBeenCalledWith(3);
  });

  it('applies both offset and limit when both are provided', async () => {
    await service.find(null, { offset: 5, limit: 10 });

    expect(mockDb.collection.offset).toHaveBeenCalledWith(5);
    expect(mockDb.collection.limit).toHaveBeenCalledWith(10);
  });

  it('returns [] when the snapshot is empty', async () => {
    mockDb.collection.get.mockResolvedValue({ empty: true, docs: [] });

    const result = await service.find(null, {});

    expect(result).toEqual([]);
  });

  it('returns documents mapped through docParser when snapshot is non-empty', async () => {
    const docParser = jest.fn((doc) => ({ id: doc.id }));
    service = new CrudService('items', docParser);
    const fakeDocs = [{ id: 'x' }, { id: 'y' }];
    mockDb.collection.get.mockResolvedValue({ empty: false, docs: fakeDocs });

    const result = await service.find(null, {});

    expect(result).toEqual([{ id: 'x' }, { id: 'y' }]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// findOne(id)
// ──────────────────────────────────────────────────────────────────────────────

describe('CrudService — findOne()', () => {
  it('calls db.get with the given id', async () => {
    const service = new CrudService('items');
    mockDb.get.mockResolvedValue({ id: 'abc' });

    await service.findOne('abc');

    expect(mockDb.get).toHaveBeenCalledWith('abc');
  });

  it('returns docParser applied to the document snapshot', async () => {
    const docParser = jest.fn((snap) => ({ ...snap, parsed: true }));
    const service = new CrudService('items', docParser);
    mockDb.get.mockResolvedValue({ id: 'abc', name: 'test' });

    const result = await service.findOne('abc');

    expect(result).toEqual({ id: 'abc', name: 'test', parsed: true });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// update(data)
// ──────────────────────────────────────────────────────────────────────────────

describe('CrudService — update()', () => {
  it('calls db.update with data.id and updateParser(data)', async () => {
    const updateParser = jest.fn((o) => ({ name: o.name }));
    const service = new CrudService('items', undefined, undefined, updateParser);
    const snap = { id: '1', name: 'updated' };
    mockDb.update.mockResolvedValue(snap);

    await service.update({ id: '1', name: 'updated', extra: 'stripped' });

    expect(mockDb.update).toHaveBeenCalledWith('1', { name: 'updated' });
  });

  it('returns docParser applied to the updated document snapshot', async () => {
    const docParser = jest.fn((snap) => ({ ...snap, fromFirestore: true }));
    const service = new CrudService('items', docParser);
    const snap = { id: '1', name: 'updated' };
    mockDb.update.mockResolvedValue(snap);

    const result = await service.update({ id: '1', name: 'updated' });

    expect(result).toEqual({ id: '1', name: 'updated', fromFirestore: true });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// delete(id)
// ──────────────────────────────────────────────────────────────────────────────

describe('CrudService — delete()', () => {
  it('calls db.delete with the given id', async () => {
    const service = new CrudService('items');
    mockDb.delete.mockResolvedValue('abc');

    await service.delete('abc');

    expect(mockDb.delete).toHaveBeenCalledWith('abc');
  });

  it('returns the deleted document id', async () => {
    const service = new CrudService('items');
    mockDb.delete.mockResolvedValue('abc');

    const result = await service.delete('abc');

    expect(result).toBe('abc');
  });
});
