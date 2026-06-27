'use strict';

/**
 * Unit tests for src/api/users/utils/user-public.js
 *
 * toPublic() is a pure function with no side effects — no mocks needed.
 */

const { toPublic } = require('../user-public');

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

/**
 * Creates a fully-populated user object including fields that must NOT appear
 * in the public view (auth, googleToken, etc.).
 */
function makeUser(overrides = {}) {
  return {
    id: 'user-1',
    email: 'alice@example.com',
    firstName: 'Alice',
    lastName: 'Smith',
    groups: ['fc'],
    role: 'user',
    deletedAt: null,
    created: new Date('2024-01-01'),
    updated: new Date('2024-06-01'),
    // Sensitive fields that must be stripped by toPublic()
    auth: { googleToken: 'gt', googleRefreshToken: 'grt' },
    googleToken: 'gt',
    googleRefreshToken: 'grt',
    refreshToken: null,
    apiToken: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('toPublic(user)', () => {
  it('returns exactly the 9 expected public fields', () => {
    const result = toPublic(makeUser());
    const keys = Object.keys(result).sort();
    expect(keys).toEqual(
      ['created', 'deletedAt', 'email', 'firstName', 'groups', 'id', 'lastName', 'role', 'updated'],
    );
  });

  it('includes deletedAt as null when the user is active', () => {
    const user = makeUser({ deletedAt: null });
    const result = toPublic(user);
    // deletedAt: null must be explicitly present in the result, not omitted
    expect(Object.prototype.hasOwnProperty.call(result, 'deletedAt')).toBe(true);
    expect(result.deletedAt).toBeNull();
  });

  it('includes deletedAt when it has a Date value (soft-deleted user)', () => {
    const deletedAt = new Date('2025-01-15T10:00:00Z');
    const user = makeUser({ deletedAt });
    const result = toPublic(user);
    expect(result.deletedAt).toBe(deletedAt);
  });

  it('does not include auth or other sensitive fields not in the public model', () => {
    const user = makeUser({
      auth: { googleToken: 'gt', googleRefreshToken: 'grt' },
      googleToken: 'gt',
      googleRefreshToken: 'grt',
      refreshToken: 'rt',
      apiToken: 'at',
    });
    const result = toPublic(user);
    expect(result).not.toHaveProperty('auth');
    expect(result).not.toHaveProperty('googleToken');
    expect(result).not.toHaveProperty('googleRefreshToken');
    expect(result).not.toHaveProperty('refreshToken');
    expect(result).not.toHaveProperty('apiToken');
  });
});
