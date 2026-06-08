const { Group } = require('../../models/group.model.api');
const { groupDocParser, createGroupParser, updateGroupParser } = require('../group.parser.api');

// ─────────────────────────────────────────────────────────────────────────────
// groupDocParser
// ─────────────────────────────────────────────────────────────────────────────
describe('groupDocParser', () => {
  function makeDocSnap({ id = 'group-1', data = {} } = {}) {
    return {
      ref: { id },
      data: () => ({
        name: 'Facultad de Ciencias',
        slug: 'fc',
        users: ['user@test.com'],
        created: { toMillis: () => 1000000 },
        updated: { toMillis: () => 2000000 },
        ...data,
      }),
    };
  }

  it('returns a Group instance with the correct id from docSnap.ref.id', () => {
    const snap = makeDocSnap({ id: 'grp-42' });
    const result = groupDocParser(snap);
    expect(result).toBeInstanceOf(Group);
    expect(result.id).toBe('grp-42');
  });

  it('assigns name and slug from the document data', () => {
    const snap = makeDocSnap();
    const result = groupDocParser(snap);
    expect(result.name).toBe('Facultad de Ciencias');
    expect(result.slug).toBe('fc');
  });

  it('assigns users from the document data', () => {
    const snap = makeDocSnap();
    const result = groupDocParser(snap);
    expect(result.users).toEqual(['user@test.com']);
  });

  it('converts created Timestamp to a Date', () => {
    const snap = makeDocSnap();
    const result = groupDocParser(snap);
    expect(result.created).toBeInstanceOf(Date);
    expect(result.created.getTime()).toBe(1000000);
  });

  it('converts updated Timestamp to a Date', () => {
    const snap = makeDocSnap();
    const result = groupDocParser(snap);
    expect(result.updated).toBeInstanceOf(Date);
    expect(result.updated.getTime()).toBe(2000000);
  });

  it('includes document fields even when users array is empty', () => {
    const snap = makeDocSnap({ data: { users: [] } });
    const result = groupDocParser(snap);
    expect(result.users).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createGroupParser
// ─────────────────────────────────────────────────────────────────────────────
describe('createGroupParser', () => {
  it('includes name and slug in the output', () => {
    const group = new Group({ name: 'Test Group', slug: 'tg' });
    const result = createGroupParser(group);
    expect(result.name).toBe('Test Group');
    expect(result.slug).toBe('tg');
  });

  it('defaults users to [] when group.users is undefined', () => {
    const group = new Group({ name: 'Test', slug: 'test' });
    expect(group.users).toBeUndefined();
    const result = createGroupParser(group);
    expect(result.users).toEqual([]);
  });

  it('preserves users when group.users is an explicit array', () => {
    const group = new Group({ name: 'Test', slug: 'test', users: ['a@test.com', 'b@test.com'] });
    const result = createGroupParser(group);
    expect(result.users).toEqual(['a@test.com', 'b@test.com']);
  });

  it('preserves users when group.users is an empty array', () => {
    const group = new Group({ name: 'Test', slug: 'test', users: [] });
    const result = createGroupParser(group);
    expect(result.users).toEqual([]);
  });

  it('does not include id in the output', () => {
    const group = new Group({ id: 'group-1', name: 'Test', slug: 'test' });
    const result = createGroupParser(group);
    expect(result.id).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateGroupParser
// ─────────────────────────────────────────────────────────────────────────────
describe('updateGroupParser', () => {
  it('removes id from the output', () => {
    const group = new Group({ id: 'group-1', name: 'Test', slug: 'test' });
    const result = updateGroupParser(group);
    expect(result.id).toBeUndefined();
  });

  it('removes created from the output', () => {
    const group = new Group({ name: 'Test', slug: 'test', created: new Date() });
    const result = updateGroupParser(group);
    expect(result.created).toBeUndefined();
  });

  it('removes updated from the output', () => {
    const group = new Group({ name: 'Test', slug: 'test', updated: new Date() });
    const result = updateGroupParser(group);
    expect(result.updated).toBeUndefined();
  });

  it('removes slug from the output — slug is immutable', () => {
    const group = new Group({ name: 'Test', slug: 'test' });
    const result = updateGroupParser(group);
    expect(result.slug).toBeUndefined();
  });

  it('preserves name in the output', () => {
    const group = new Group({ name: 'Updated Name', slug: 'test' });
    const result = updateGroupParser(group);
    expect(result.name).toBe('Updated Name');
  });

  it('preserves users when provided as a non-empty array', () => {
    const group = new Group({ name: 'Test', slug: 'test', users: ['a@test.com'] });
    const result = updateGroupParser(group);
    expect(result.users).toEqual(['a@test.com']);
  });

  it('preserves users: [] — empty array is a valid update (empties the group)', () => {
    const group = new Group({ name: 'Test', slug: 'test', users: [] });
    const result = updateGroupParser(group);
    expect(result.users).toEqual([]);
  });

  it('omits users when group.users is undefined — cleanDocObject removes undefined keys', () => {
    const group = new Group({ name: 'Test', slug: 'test' });
    expect(group.users).toBeUndefined();
    const result = updateGroupParser(group);
    expect(Object.prototype.hasOwnProperty.call(result, 'users')).toBe(false);
  });

  it('does not mutate the original Group instance', () => {
    const group = new Group({ id: 'g-1', name: 'Test', slug: 'test', users: ['a@test.com'] });
    const originalSlug = group.slug;
    updateGroupParser(group);
    expect(group.slug).toBe(originalSlug);
    expect(group.id).toBe('g-1');
  });
});
