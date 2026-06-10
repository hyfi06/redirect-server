'use strict';

const User = require('../user.model');

describe('User model', () => {
  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------
  describe('constructor', () => {
    it('sets id to null when not provided', () => {
      const user = new User({ email: 'a@example.com' });
      expect(user.id).toBeNull();
    });

    it('sets id from data when provided', () => {
      const user = new User({ email: 'a@example.com', id: 'user-123' });
      expect(user.id).toBe('user-123');
    });

    it('lowercases and trims the email', () => {
      const user = new User({ email: '  Test@EXAMPLE.COM  ' });
      expect(user.email).toBe('test@example.com');
    });

    it('trims firstName and lastName when provided', () => {
      const user = new User({ email: 'a@example.com', firstName: '  Juan  ', lastName: '  Pérez  ' });
      expect(user.firstName).toBe('Juan');
      expect(user.lastName).toBe('Pérez');
    });

    it('defaults firstName and lastName to empty string when absent', () => {
      const user = new User({ email: 'a@example.com' });
      expect(user.firstName).toBe('');
      expect(user.lastName).toBe('');
    });

    it('defaults groups to empty array when not provided', () => {
      const user = new User({ email: 'a@example.com' });
      expect(user.groups).toEqual([]);
    });

    it('sets groups from data when provided', () => {
      const user = new User({ email: 'a@example.com', groups: ['admins', 'editors'] });
      expect(user.groups).toEqual(['admins', 'editors']);
    });

    it('leaves role undefined when not provided', () => {
      const user = new User({ email: 'a@example.com' });
      expect(user.role).toBeUndefined();
    });

    it('sets role to "user" when provided explicitly', () => {
      const user = new User({ email: 'a@example.com', role: 'user' });
      expect(user.role).toBe('user');
    });

    it('sets role to "admin" when provided explicitly', () => {
      const user = new User({ email: 'a@example.com', role: 'admin' });
      expect(user.role).toBe('admin');
    });

    it('stores auth tokens inside this.auth', () => {
      const user = new User({
        email: 'a@example.com',
        googleToken: 'gtoken',
        googleRefreshToken: 'grtoken',
        refreshToken: 'rtoken',
        apiToken: 'atoken',
      });
      expect(user.auth).toEqual({
        googleToken: 'gtoken',
        googleRefreshToken: 'grtoken',
        refreshToken: 'rtoken',
        apiToken: 'atoken',
      });
    });

    it('sets created and updated when provided', () => {
      const created = new Date('2024-01-01');
      const updated = new Date('2024-06-01');
      const user = new User({ email: 'a@example.com', created, updated });
      expect(user.created).toBe(created);
      expect(user.updated).toBe(updated);
    });

    it('does not set created or updated when absent', () => {
      const user = new User({ email: 'a@example.com' });
      expect(user.created).toBeUndefined();
      expect(user.updated).toBeUndefined();
    });

    // Regression guard: PATCH handler calls new User({ id, ...value }) where value
    // never contains email (both update schemas forbid it). Before the fix, this
    // crashed with "TypeError: Cannot read properties of undefined (reading 'toLowerCase')".
    it('does not throw when email is absent and sets this.email to undefined', () => {
      expect(() => new User({ id: 'user-123', firstName: 'Test' })).not.toThrow();
      const user = new User({ id: 'user-123', firstName: 'Test' });
      expect(user.email).toBeUndefined();
    });

    it('does not throw when email is explicitly undefined', () => {
      expect(() => new User({ email: undefined, id: 'user-123' })).not.toThrow();
      const user = new User({ email: undefined, id: 'user-123' });
      expect(user.email).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // toPublic()
  // -------------------------------------------------------------------------
  describe('toPublic()', () => {
    it('returns all public fields for a fully populated user', () => {
      const created = new Date('2024-01-01');
      const updated = new Date('2024-06-01');
      const user = new User({
        id: 'user-abc',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        groups: ['editors'],
        role: 'admin',
        googleToken: 'gtoken',
        googleRefreshToken: 'grtoken',
        refreshToken: 'rtoken',
        apiToken: 'atoken',
        created,
        updated,
      });

      const result = user.toPublic();

      expect(result).toEqual({
        id: 'user-abc',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        groups: ['editors'],
        role: 'admin',
        created,
        updated,
      });
    });

    it('does not include the auth key in the result', () => {
      const user = new User({
        email: 'test@example.com',
        googleToken: 'gtoken',
        googleRefreshToken: 'grtoken',
        refreshToken: 'rtoken',
        apiToken: 'atoken',
      });

      const result = user.toPublic();

      expect(result).not.toHaveProperty('auth');
    });

    it('does not include googleToken in the result', () => {
      const user = new User({ email: 'test@example.com', googleToken: 'secret' });
      expect(user.toPublic()).not.toHaveProperty('googleToken');
    });

    it('does not include googleRefreshToken in the result', () => {
      const user = new User({ email: 'test@example.com', googleRefreshToken: 'secret' });
      expect(user.toPublic()).not.toHaveProperty('googleRefreshToken');
    });

    it('does not include refreshToken in the result', () => {
      const user = new User({ email: 'test@example.com', refreshToken: 'secret' });
      expect(user.toPublic()).not.toHaveProperty('refreshToken');
    });

    it('does not include apiToken in the result', () => {
      const user = new User({ email: 'test@example.com', apiToken: 'secret' });
      expect(user.toPublic()).not.toHaveProperty('apiToken');
    });

    it('returns created and updated as undefined when not set on the instance', () => {
      const user = new User({ email: 'test@example.com' });

      const result = user.toPublic();

      expect(result.created).toBeUndefined();
      expect(result.updated).toBeUndefined();
    });

    it('returns a plain object (not a User instance)', () => {
      const user = new User({ email: 'test@example.com' });
      expect(user.toPublic()).not.toBeInstanceOf(User);
    });
  });

  // -------------------------------------------------------------------------
  // fullNameByName getter
  // -------------------------------------------------------------------------
  describe('fullNameByName getter', () => {
    it('returns "firstName lastName" with a single space', () => {
      const user = new User({ email: 'a@example.com', firstName: 'Juan', lastName: 'Pérez' });
      expect(user.fullNameByName).toBe('Juan Pérez');
    });

    it('returns only firstName when lastName is absent', () => {
      const user = new User({ email: 'a@example.com', firstName: 'Juan' });
      expect(user.fullNameByName).toBe('Juan');
    });

    it('returns only lastName when firstName is absent', () => {
      const user = new User({ email: 'a@example.com', lastName: 'Pérez' });
      expect(user.fullNameByName).toBe('Pérez');
    });

    it('returns an empty string when both names are absent', () => {
      const user = new User({ email: 'a@example.com' });
      expect(user.fullNameByName).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // fullNameByLastName getter
  // -------------------------------------------------------------------------
  describe('fullNameByLastName getter', () => {
    it('returns "lastName firstName" with a single space', () => {
      const user = new User({ email: 'a@example.com', firstName: 'Juan', lastName: 'Pérez' });
      expect(user.fullNameByLastName).toBe('Pérez Juan');
    });

    it('returns only firstName when lastName is absent', () => {
      const user = new User({ email: 'a@example.com', firstName: 'Juan' });
      expect(user.fullNameByLastName).toBe('Juan');
    });

    it('returns only lastName when firstName is absent', () => {
      const user = new User({ email: 'a@example.com', lastName: 'Pérez' });
      expect(user.fullNameByLastName).toBe('Pérez');
    });
  });
});
