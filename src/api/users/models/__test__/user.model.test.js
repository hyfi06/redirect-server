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

    it('leaves firstName and lastName undefined when absent (D20: no default in constructor)', () => {
      const user = new User({ email: 'a@example.com' });
      expect(user.firstName).toBeUndefined();
      expect(user.lastName).toBeUndefined();
    });

    it('leaves groups undefined when not provided (D20: no default in constructor)', () => {
      const user = new User({ email: 'a@example.com' });
      expect(user.groups).toBeUndefined();
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
