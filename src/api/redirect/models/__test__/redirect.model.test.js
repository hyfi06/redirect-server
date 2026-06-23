'use strict';

const Redirect = require('../redirect.model');

describe('Redirect constructor', () => {
  const fullData = {
    id: 'r-1',
    path: '/fc/seminar',
    url: 'https://example.com',
    owner: 'user@test.com',
    permission: ['read:fc'],
    categories: ['events'],
    created: new Date(1000000),
    updated: new Date(2000000),
  };

  it('assigns all fields when full data is provided', () => {
    const r = new Redirect(fullData);
    expect(r.id).toBe('r-1');
    expect(r.path).toBe('/fc/seminar');
    expect(r.url).toBe('https://example.com');
    expect(r.owner).toBe('user@test.com');
    expect(r.permission).toEqual(['read:fc']);
    expect(r.categories).toEqual(['events']);
    expect(r.created).toEqual(new Date(1000000));
    expect(r.updated).toEqual(new Date(2000000));
  });

  it('sets id to null when id is not provided', () => {
    const r = new Redirect({ path: '/fc/test', url: 'https://example.com', owner: 'a@test.com' });
    expect(r.id).toBeNull();
  });

  it('sets id to the provided value when id is present', () => {
    const r = new Redirect({ ...fullData, id: 'explicit-id' });
    expect(r.id).toBe('explicit-id');
  });

  it('leaves permission undefined when permission is not provided', () => {
    const r = new Redirect({ path: '/fc/test', url: 'https://example.com', owner: 'a@test.com' });
    expect(r.permission).toBeUndefined();
  });

  it('assigns permission when permission is provided', () => {
    const r = new Redirect({ path: '/fc/test', url: 'https://example.com', owner: 'a@test.com', permission: ['read:fc'] });
    expect(r.permission).toEqual(['read:fc']);
  });

  it('leaves categories undefined when categories is not provided', () => {
    const r = new Redirect({ path: '/fc/test', url: 'https://example.com', owner: 'a@test.com' });
    expect(r.categories).toBeUndefined();
  });

  it('assigns categories when categories is provided', () => {
    const r = new Redirect({ path: '/fc/test', url: 'https://example.com', owner: 'a@test.com', categories: ['conf'] });
    expect(r.categories).toEqual(['conf']);
  });

  it('leaves created undefined when created is not provided', () => {
    const r = new Redirect({ path: '/fc/test', url: 'https://example.com', owner: 'a@test.com' });
    expect(r.created).toBeUndefined();
  });

  it('assigns created when created is provided', () => {
    const date = new Date(1000000);
    const r = new Redirect({ path: '/fc/test', url: 'https://example.com', owner: 'a@test.com', created: date });
    expect(r.created).toBe(date);
  });

  it('leaves updated undefined when updated is not provided', () => {
    const r = new Redirect({ path: '/fc/test', url: 'https://example.com', owner: 'a@test.com' });
    expect(r.updated).toBeUndefined();
  });

  it('assigns updated when updated is provided', () => {
    const date = new Date(2000000);
    const r = new Redirect({ path: '/fc/test', url: 'https://example.com', owner: 'a@test.com', updated: date });
    expect(r.updated).toBe(date);
  });
});
