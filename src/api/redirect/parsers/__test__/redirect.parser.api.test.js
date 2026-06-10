'use strict';

jest.mock('@google-cloud/firestore');

const Redirect = require('../../models/redirect.models.api');
const {
  redirectParser,
  createRedirectParser,
  updateRedirectParser,
} = require('../redirect.parser.api');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeDocSnap({
  id = 'r-1',
  path = '/fc/seminar',
  url = 'https://example.com',
  owner = 'user@test.com',
  permission = ['read:fc'],
  categories = ['events'],
  createdMillis = 1000000,
  updatedMillis = 2000000,
} = {}) {
  return {
    ref: { id },
    data: () => ({
      path,
      url,
      owner,
      permission,
      categories,
      created: { toMillis: () => createdMillis },
      updated: { toMillis: () => updatedMillis },
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// redirectParser
// ─────────────────────────────────────────────────────────────────────────────

describe('redirectParser', () => {
  it('returns a Redirect instance', () => {
    const snap = makeDocSnap();
    const result = redirectParser(snap);
    expect(result).toBeInstanceOf(Redirect);
  });

  it('assigns the id from docSnap.ref.id', () => {
    const snap = makeDocSnap({ id: 'snap-id-42' });
    const result = redirectParser(snap);
    expect(result.id).toBe('snap-id-42');
  });

  it('converts created Timestamp to a Date using toMillis()', () => {
    const snap = makeDocSnap({ createdMillis: 1111111 });
    const result = redirectParser(snap);
    expect(result.created).toBeInstanceOf(Date);
    expect(result.created.getTime()).toBe(1111111);
  });

  it('converts updated Timestamp to a Date using toMillis()', () => {
    const snap = makeDocSnap({ updatedMillis: 2222222 });
    const result = redirectParser(snap);
    expect(result.updated).toBeInstanceOf(Date);
    expect(result.updated.getTime()).toBe(2222222);
  });

  it('passes path from document data', () => {
    const snap = makeDocSnap({ path: '/fc/test' });
    const result = redirectParser(snap);
    expect(result.path).toBe('/fc/test');
  });

  it('passes url from document data', () => {
    const snap = makeDocSnap({ url: 'https://target.com' });
    const result = redirectParser(snap);
    expect(result.url).toBe('https://target.com');
  });

  it('passes owner from document data', () => {
    const snap = makeDocSnap({ owner: 'owner@test.com' });
    const result = redirectParser(snap);
    expect(result.owner).toBe('owner@test.com');
  });

  it('passes permission from document data', () => {
    const snap = makeDocSnap({ permission: ['read:fc', 'read:cs'] });
    const result = redirectParser(snap);
    expect(result.permission).toEqual(['read:fc', 'read:cs']);
  });

  it('passes categories from document data', () => {
    const snap = makeDocSnap({ categories: ['conf', 'seminar'] });
    const result = redirectParser(snap);
    expect(result.categories).toEqual(['conf', 'seminar']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createRedirectParser
// ─────────────────────────────────────────────────────────────────────────────

describe('createRedirectParser', () => {
  it('strips trailing slash from path', () => {
    const redirect = new Redirect({ path: '/fc/seminar/', url: 'https://example.com', owner: 'a@test.com' });
    const result = createRedirectParser(redirect);
    expect(result.path).toBe('/fc/seminar');
  });

  it('preserves path that has no trailing slash', () => {
    const redirect = new Redirect({ path: '/fc/seminar', url: 'https://example.com', owner: 'a@test.com' });
    const result = createRedirectParser(redirect);
    expect(result.path).toBe('/fc/seminar');
  });

  it('defaults permission to [] when permission is undefined', () => {
    const redirect = new Redirect({ path: '/fc/test', url: 'https://example.com', owner: 'a@test.com' });
    expect(redirect.permission).toBeUndefined();
    const result = createRedirectParser(redirect);
    expect(result.permission).toEqual([]);
  });

  it('defaults permission to [] when permission is null', () => {
    const redirect = { path: '/fc/test', url: 'https://example.com', owner: 'a@test.com', permission: null };
    const result = createRedirectParser(redirect);
    expect(result.permission).toEqual([]);
  });

  it('preserves permission when it is a non-empty array', () => {
    const redirect = new Redirect({ path: '/fc/test', url: 'https://example.com', owner: 'a@test.com', permission: ['read:fc'] });
    const result = createRedirectParser(redirect);
    expect(result.permission).toEqual(['read:fc']);
  });

  it('defaults categories to [] when categories is undefined', () => {
    const redirect = new Redirect({ path: '/fc/test', url: 'https://example.com', owner: 'a@test.com' });
    expect(redirect.categories).toBeUndefined();
    const result = createRedirectParser(redirect);
    expect(result.categories).toEqual([]);
  });

  it('defaults categories to [] when categories is null', () => {
    const redirect = { path: '/fc/test', url: 'https://example.com', owner: 'a@test.com', categories: null };
    const result = createRedirectParser(redirect);
    expect(result.categories).toEqual([]);
  });

  it('preserves categories when it is a non-empty array', () => {
    const redirect = new Redirect({ path: '/fc/test', url: 'https://example.com', owner: 'a@test.com', categories: ['conf'] });
    const result = createRedirectParser(redirect);
    expect(result.categories).toEqual(['conf']);
  });

  it('includes owner in the output', () => {
    const redirect = new Redirect({ path: '/fc/test', url: 'https://example.com', owner: 'owner@test.com' });
    const result = createRedirectParser(redirect);
    expect(result.owner).toBe('owner@test.com');
  });

  it('does not include id in the output', () => {
    const redirect = new Redirect({ id: 'r-1', path: '/fc/test', url: 'https://example.com', owner: 'a@test.com' });
    const result = createRedirectParser(redirect);
    expect(result).not.toHaveProperty('id');
  });

  it('does not include created in the output', () => {
    const redirect = new Redirect({ path: '/fc/test', url: 'https://example.com', owner: 'a@test.com', created: new Date() });
    const result = createRedirectParser(redirect);
    expect(result).not.toHaveProperty('created');
  });

  it('does not include updated in the output', () => {
    const redirect = new Redirect({ path: '/fc/test', url: 'https://example.com', owner: 'a@test.com', updated: new Date() });
    const result = createRedirectParser(redirect);
    expect(result).not.toHaveProperty('updated');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateRedirectParser
// ─────────────────────────────────────────────────────────────────────────────

describe('updateRedirectParser', () => {
  it('removes id from the output', () => {
    const redirect = new Redirect({ id: 'r-1', path: '/fc/test', url: 'https://example.com', owner: 'a@test.com' });
    const result = updateRedirectParser(redirect);
    expect(result).not.toHaveProperty('id');
  });

  it('removes created from the output', () => {
    const redirect = new Redirect({ path: '/fc/test', url: 'https://example.com', owner: 'a@test.com', created: new Date() });
    const result = updateRedirectParser(redirect);
    expect(result).not.toHaveProperty('created');
  });

  it('removes updated from the output', () => {
    const redirect = new Redirect({ path: '/fc/test', url: 'https://example.com', owner: 'a@test.com', updated: new Date() });
    const result = updateRedirectParser(redirect);
    expect(result).not.toHaveProperty('updated');
  });

  it('removes owner from the output — owner is immutable', () => {
    const redirect = new Redirect({ path: '/fc/test', url: 'https://example.com', owner: 'a@test.com' });
    const result = updateRedirectParser(redirect);
    expect(result).not.toHaveProperty('owner');
  });

  it('removes keys with undefined value via cleanDocObject', () => {
    const redirect = new Redirect({ path: '/fc/test', url: 'https://example.com', owner: 'a@test.com' });
    // permission and categories are undefined on this instance
    const result = updateRedirectParser(redirect);
    expect(Object.prototype.hasOwnProperty.call(result, 'permission')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, 'categories')).toBe(false);
  });

  it('preserves path in the output', () => {
    const redirect = new Redirect({ path: '/fc/seminar', url: 'https://example.com', owner: 'a@test.com' });
    const result = updateRedirectParser(redirect);
    expect(result.path).toBe('/fc/seminar');
  });

  it('preserves url in the output', () => {
    const redirect = new Redirect({ path: '/fc/test', url: 'https://target.com', owner: 'a@test.com' });
    const result = updateRedirectParser(redirect);
    expect(result.url).toBe('https://target.com');
  });

  it('preserves permission when it is a non-empty array', () => {
    const redirect = new Redirect({ path: '/fc/test', url: 'https://example.com', owner: 'a@test.com', permission: ['read:fc'] });
    const result = updateRedirectParser(redirect);
    expect(result.permission).toEqual(['read:fc']);
  });

  it('preserves categories when provided', () => {
    const redirect = new Redirect({ path: '/fc/test', url: 'https://example.com', owner: 'a@test.com', categories: ['conf'] });
    const result = updateRedirectParser(redirect);
    expect(result.categories).toEqual(['conf']);
  });

  it('does not mutate the original Redirect instance', () => {
    const redirect = new Redirect({ id: 'r-1', path: '/fc/test', url: 'https://example.com', owner: 'a@test.com' });
    updateRedirectParser(redirect);
    expect(redirect.id).toBe('r-1');
    expect(redirect.owner).toBe('a@test.com');
  });
});
