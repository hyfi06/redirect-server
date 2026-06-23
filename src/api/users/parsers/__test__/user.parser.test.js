'use strict';

const {
  createUserParser,
  updateUserParser,
} = require('../user.parser');

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Returns a plain object shaped like a User instance with all auth tokens
 * set to undefined — which is exactly what `new User({ firstName: 'Juan', ... })`
 * produces when no token fields are provided.
 */
function makeUserWithNoTokens(overrides = {}) {
  return {
    id: 'some-id',
    email: 'test@example.com',
    firstName: 'Juan',
    lastName: 'Perez',
    groups: [],
    role: 'user',
    created: new Date('2024-01-01'),
    updated: new Date('2024-01-02'),
    auth: {
      googleToken: undefined,
      googleRefreshToken: undefined,
      refreshToken: undefined,
      apiToken: undefined,
    },
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// updateUserParser — spec task 0.3
// ──────────────────────────────────────────────────────────────────────────────

describe('updateUserParser', () => {
  // ── spec case 1 ────────────────────────────────────────────────────────────
  it('omits auth when all token fields are undefined (PATCH with only firstName)', () => {
    const user = makeUserWithNoTokens({ firstName: 'Juan' });

    const data = updateUserParser(user);

    expect(data).not.toHaveProperty('auth');
  });

  // ── spec case 2 ────────────────────────────────────────────────────────────
  it('preserves auth when at least one token has a real value (PATCH with apiToken)', () => {
    const user = makeUserWithNoTokens({
      auth: {
        apiToken: 'xyz',
        googleToken: undefined,
        googleRefreshToken: undefined,
        refreshToken: undefined,
      },
    });

    const data = updateUserParser(user);

    expect(data.auth).toEqual({ apiToken: 'xyz' });
  });

  // ── spec case 3 ────────────────────────────────────────────────────────────
  it('omits auth when auth is completely absent from the input object', () => {
    const user = makeUserWithNoTokens();
    delete user.auth;

    const data = updateUserParser(user);

    expect(data).not.toHaveProperty('auth');
  });

  // ── spec case 4 ────────────────────────────────────────────────────────────
  it('always excludes id from the returned object', () => {
    const user = makeUserWithNoTokens();

    const data = updateUserParser(user);

    expect(data).not.toHaveProperty('id');
  });

  it('always excludes created from the returned object', () => {
    const user = makeUserWithNoTokens();

    const data = updateUserParser(user);

    expect(data).not.toHaveProperty('created');
  });

  it('always excludes email from the returned object', () => {
    const user = makeUserWithNoTokens();

    const data = updateUserParser(user);

    expect(data).not.toHaveProperty('email');
  });

  // ── additional edge cases ──────────────────────────────────────────────────

  it('excludes updated from the returned object', () => {
    const user = makeUserWithNoTokens();

    const data = updateUserParser(user);

    expect(data).not.toHaveProperty('updated');
  });

  it('preserves firstName in the returned object', () => {
    const user = makeUserWithNoTokens({ firstName: 'Maria' });

    const data = updateUserParser(user);

    expect(data.firstName).toBe('Maria');
  });

  it('preserves lastName in the returned object', () => {
    const user = makeUserWithNoTokens({ lastName: 'Lopez' });

    const data = updateUserParser(user);

    expect(data.lastName).toBe('Lopez');
  });

  it('preserves role "admin" when provided explicitly', () => {
    const user = makeUserWithNoTokens({ role: 'admin' });

    const data = updateUserParser(user);

    expect(data.role).toBe('admin');
  });

  it('omits role when user.role is undefined (cleanDocObject strips it)', () => {
    const user = makeUserWithNoTokens({ role: undefined });

    const data = updateUserParser(user);

    expect(data).not.toHaveProperty('role');
  });

  it('preserves groups in the returned object', () => {
    const user = makeUserWithNoTokens({ groups: ['team-a'] });

    const data = updateUserParser(user);

    expect(data.groups).toEqual(['team-a']);
  });

  // Regression guard: PATCH body without groups must not write groups to Firestore.
  // Before the fix, User constructor defaulted groups to [] even when absent, so
  // updateUserParser passed groups: [] to Firestore — overwriting real group membership.
  it('omits groups key when user.groups is undefined — PATCH without groups must not touch Firestore groups field', () => {
    // Simulate new User({ id, lastName: 'X' }) after the D20 fix:
    // groups is not in the PATCH body, so the constructor sets this.groups = undefined.
    const user = makeUserWithNoTokens({ groups: undefined });

    const data = updateUserParser(user);

    expect(data).not.toHaveProperty('groups');
  });

  // Regression guard: PATCH body with only firstName must not write lastName to Firestore.
  // Before the fix, User constructor defaulted firstName/lastName to '' even when absent,
  // so updateUserParser passed lastName: '' to Firestore — erasing the existing value.
  it('omits lastName key when user.lastName is undefined — PATCH with only firstName must not touch Firestore lastName field', () => {
    // Simulate new User({ id, firstName: 'Becas' }) after the hotfix:
    // lastName is not in the PATCH body, so the constructor sets this.lastName = undefined.
    const user = makeUserWithNoTokens({ firstName: 'Becas', lastName: undefined });

    const data = updateUserParser(user);

    expect(data).not.toHaveProperty('lastName');
  });

  it('omits firstName key when user.firstName is undefined — PATCH with only lastName must not touch Firestore firstName field', () => {
    // Simulate new User({ id, lastName: 'Ciencias' }) after the hotfix:
    // firstName is not in the PATCH body, so the constructor sets this.firstName = undefined.
    const user = makeUserWithNoTokens({ firstName: undefined, lastName: 'Ciencias' });

    const data = updateUserParser(user);

    expect(data).not.toHaveProperty('firstName');
  });

  it('preserves both firstName and lastName when both are present in the PATCH body (control positive)', () => {
    const user = makeUserWithNoTokens({ firstName: 'Ana', lastName: 'Torres' });

    const data = updateUserParser(user);

    expect(data.firstName).toBe('Ana');
    expect(data.lastName).toBe('Torres');
  });

  it('keeps only defined token fields when auth has a mix of defined and undefined values', () => {
    const user = makeUserWithNoTokens({
      auth: {
        googleToken: 'gtoken',
        googleRefreshToken: undefined,
        refreshToken: 'rtoken',
        apiToken: undefined,
      },
    });

    const data = updateUserParser(user);

    expect(data.auth).toEqual({ googleToken: 'gtoken', refreshToken: 'rtoken' });
  });

  it('does not mutate the caller-visible fields of the original user object', () => {
    const user = makeUserWithNoTokens({ firstName: 'Carlos' });

    updateUserParser(user);

    // id and email must still be present on the original — the parser should
    // only mutate the shallow copy, not strip fields from the source object.
    expect(user.id).toBe('some-id');
    expect(user.email).toBe('test@example.com');
  });

  it('mutates user.auth in place because the shallow copy shares the same reference', () => {
    // The shallow spread `{ ...user }` does not deep-clone auth.
    // cleanDocObject(data.auth) therefore also modifies user.auth.
    // This test documents that known side-effect so callers are aware.
    const user = makeUserWithNoTokens();
    const originalAuthRef = user.auth;

    updateUserParser(user);

    // The reference is still the same object, but undefined keys were removed.
    expect(user.auth).toBe(originalAuthRef);
    expect(user.auth).not.toHaveProperty('googleToken');
    expect(user.auth).not.toHaveProperty('apiToken');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// createUserParser
// ──────────────────────────────────────────────────────────────────────────────

describe('createUserParser', () => {
  it('includes email in the returned object', () => {
    const user = makeUserWithNoTokens();

    const data = createUserParser(user);

    expect(data.email).toBe('test@example.com');
  });

  it('includes firstName in the returned object', () => {
    const user = makeUserWithNoTokens({ firstName: 'Ana' });

    const data = createUserParser(user);

    expect(data.firstName).toBe('Ana');
  });

  it('defaults role to "user" when user.role is undefined', () => {
    const user = makeUserWithNoTokens({ role: undefined });

    const data = createUserParser(user);

    expect(data.role).toBe('user');
  });

  it('preserves role "user" when user.role is explicitly "user"', () => {
    const user = makeUserWithNoTokens({ role: 'user' });

    const data = createUserParser(user);

    expect(data.role).toBe('user');
  });

  it('preserves role "admin" when user.role is explicitly "admin"', () => {
    const user = makeUserWithNoTokens({ role: 'admin' });

    const data = createUserParser(user);

    expect(data.role).toBe('admin');
  });

  it('includes groups in the returned object', () => {
    const user = makeUserWithNoTokens({ groups: ['team-b'] });

    const data = createUserParser(user);

    expect(data.groups).toEqual(['team-b']);
  });

  // Regression guard: createUserParser is the correct place for the groups: [] default.
  // The constructor no longer provides the default (D20), so createUserParser must supply it.
  it('defaults groups to [] when user.groups is undefined — the default lives here, not in the constructor', () => {
    const user = makeUserWithNoTokens({ groups: undefined });

    const data = createUserParser(user);

    expect(data.groups).toEqual([]);
  });

  // Regression guard: createUserParser is the correct place for the firstName/lastName '' defaults.
  // The constructor no longer defaults these fields (hotfix), so createUserParser must supply them
  // so that new users always have string values in Firestore.
  it("defaults firstName to '' when user.firstName is undefined — the default lives here, not in the constructor", () => {
    const user = makeUserWithNoTokens({ firstName: undefined });

    const data = createUserParser(user);

    expect(data.firstName).toBe('');
  });

  it("defaults lastName to '' when user.lastName is undefined — the default lives here, not in the constructor", () => {
    const user = makeUserWithNoTokens({ lastName: undefined });

    const data = createUserParser(user);

    expect(data.lastName).toBe('');
  });

  it('returns auth as an empty object when all token fields are undefined', () => {
    const user = makeUserWithNoTokens();

    const data = createUserParser(user);

    // cleanDocObject removes all undefined keys, leaving {}
    expect(data.auth).toEqual({});
  });

  it('returns auth with only the defined tokens', () => {
    const user = makeUserWithNoTokens({
      auth: {
        googleToken: 'gtoken',
        googleRefreshToken: undefined,
        refreshToken: undefined,
        apiToken: 'api',
      },
    });

    const data = createUserParser(user);

    expect(data.auth).toEqual({ googleToken: 'gtoken', apiToken: 'api' });
  });

  it('does not include id in the returned object', () => {
    const user = makeUserWithNoTokens();

    const data = createUserParser(user);

    expect(data).not.toHaveProperty('id');
  });

  it('does not include created in the returned object', () => {
    const user = makeUserWithNoTokens();

    const data = createUserParser(user);

    expect(data).not.toHaveProperty('created');
  });
});
