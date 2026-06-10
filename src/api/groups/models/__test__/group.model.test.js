const { Group } = require('../group.model');

describe('Group model', () => {
  describe('constructor', () => {
    it('assigns name and slug from the input object', () => {
      const group = new Group({ name: 'Facultad de Ciencias', slug: 'fc' });
      expect(group.name).toBe('Facultad de Ciencias');
      expect(group.slug).toBe('fc');
    });

    it('defaults id to null when id is not provided', () => {
      const group = new Group({ name: 'Test', slug: 'test' });
      expect(group.id).toBeNull();
    });

    it('assigns id when provided', () => {
      const group = new Group({ id: 'group-1', name: 'Test', slug: 'test' });
      expect(group.id).toBe('group-1');
    });

    it('users is undefined when not provided — R6 fix: undefined means no change in PATCH', () => {
      const group = new Group({ name: 'Test', slug: 'test' });
      expect(group.users).toBeUndefined();
    });

    it('users is [] when provided as an empty array', () => {
      const group = new Group({ name: 'Test', slug: 'test', users: [] });
      expect(group.users).toEqual([]);
    });

    it('users is assigned the provided array', () => {
      const group = new Group({ name: 'Test', slug: 'test', users: ['a@test.com', 'b@test.com'] });
      expect(group.users).toEqual(['a@test.com', 'b@test.com']);
    });

    it('does not assign created when not provided', () => {
      const group = new Group({ name: 'Test', slug: 'test' });
      expect(group.created).toBeUndefined();
    });

    it('assigns created when provided', () => {
      const now = new Date();
      const group = new Group({ name: 'Test', slug: 'test', created: now });
      expect(group.created).toBe(now);
    });

    it('does not assign updated when not provided', () => {
      const group = new Group({ name: 'Test', slug: 'test' });
      expect(group.updated).toBeUndefined();
    });

    it('assigns updated when provided', () => {
      const now = new Date();
      const group = new Group({ name: 'Test', slug: 'test', updated: now });
      expect(group.updated).toBe(now);
    });
  });
});
