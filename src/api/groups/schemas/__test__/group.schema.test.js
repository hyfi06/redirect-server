const {
  createGroupSchema,
  updateGroupSchema,
  idParamSchema,
  getGroupQuerySchema,
} = require('../group.schema');

function validate(schema, data) {
  return schema.validate(data, { abortEarly: false });
}

// ─────────────────────────────────────────────────────────────────────────────
// createGroupSchema
// ─────────────────────────────────────────────────────────────────────────────
describe('createGroupSchema', () => {
  it('accepts minimum valid object with name and slug', () => {
    const { error } = validate(createGroupSchema, { name: 'Facultad de Ciencias', slug: 'fc' });
    expect(error).toBeUndefined();
  });

  it('accepts object with name, slug, and users array', () => {
    const { error } = validate(createGroupSchema, {
      name: 'Facultad de Ciencias',
      slug: 'fc',
      users: ['user@test.com'],
    });
    expect(error).toBeUndefined();
  });

  it('accepts an empty users array', () => {
    const { error } = validate(createGroupSchema, { name: 'Test', slug: 'test', users: [] });
    expect(error).toBeUndefined();
  });

  it('coerces slug to lowercase', () => {
    const { error, value } = validate(createGroupSchema, { name: 'Test', slug: 'FC' });
    expect(error).toBeUndefined();
    expect(value.slug).toBe('fc');
  });

  it('rejects slug with uppercase letters after coercion fails the pattern', () => {
    // slug with uppercase is coerced to lowercase by Joi, so valid
    // but slug with characters outside [a-z0-9-] is rejected
    const { error } = validate(createGroupSchema, { name: 'Test', slug: 'fc_group' });
    expect(error).toBeDefined();
  });

  it('rejects slug with underscore', () => {
    const { error } = validate(createGroupSchema, { name: 'Test', slug: 'my_group' });
    expect(error).toBeDefined();
  });

  it('rejects slug with spaces', () => {
    const { error } = validate(createGroupSchema, { name: 'Test', slug: 'my group' });
    expect(error).toBeDefined();
  });

  it('rejects slug with special characters', () => {
    const { error } = validate(createGroupSchema, { name: 'Test', slug: 'group@2' });
    expect(error).toBeDefined();
  });

  it('rejects when name is absent', () => {
    const { error } = validate(createGroupSchema, { slug: 'fc' });
    expect(error).toBeDefined();
  });

  it('rejects when slug is absent', () => {
    const { error } = validate(createGroupSchema, { name: 'Facultad de Ciencias' });
    expect(error).toBeDefined();
  });

  it('rejects an invalid email in the users array', () => {
    const { error } = validate(createGroupSchema, {
      name: 'Test',
      slug: 'test',
      users: ['not-an-email'],
    });
    expect(error).toBeDefined();
  });

  it('rejects unknown fields', () => {
    const { error } = validate(createGroupSchema, { name: 'Test', slug: 'fc', extra: 'bad' });
    expect(error).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateGroupSchema
// ─────────────────────────────────────────────────────────────────────────────
describe('updateGroupSchema', () => {
  it('accepts an empty object — all fields are optional', () => {
    const { error } = validate(updateGroupSchema, {});
    expect(error).toBeUndefined();
  });

  it('accepts object with only name', () => {
    const { error } = validate(updateGroupSchema, { name: 'New Name' });
    expect(error).toBeUndefined();
  });

  it('accepts object with only users', () => {
    const { error } = validate(updateGroupSchema, { users: ['user@test.com'] });
    expect(error).toBeUndefined();
  });

  it('accepts empty users array — empties the group membership', () => {
    const { error } = validate(updateGroupSchema, { users: [] });
    expect(error).toBeUndefined();
  });

  it('accepts both name and users', () => {
    const { error } = validate(updateGroupSchema, { name: 'New Name', users: ['a@test.com'] });
    expect(error).toBeUndefined();
  });

  it('rejects when slug is included — slug is immutable', () => {
    const { error } = validate(updateGroupSchema, { slug: 'new-slug' });
    expect(error).toBeDefined();
  });

  it('rejects an invalid email in users array', () => {
    const { error } = validate(updateGroupSchema, { users: ['not-an-email'] });
    expect(error).toBeDefined();
  });

  it('rejects unknown fields', () => {
    const { error } = validate(updateGroupSchema, { extra: 'bad' });
    expect(error).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// idParamSchema
// ─────────────────────────────────────────────────────────────────────────────
describe('idParamSchema', () => {
  it('accepts an object with a non-empty id', () => {
    const { error } = validate(idParamSchema, { id: 'group-123' });
    expect(error).toBeUndefined();
  });

  it('rejects when id is absent', () => {
    const { error } = validate(idParamSchema, {});
    expect(error).toBeDefined();
  });

  it('rejects when id is an empty string', () => {
    const { error } = validate(idParamSchema, { id: '' });
    expect(error).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getGroupQuerySchema
// ─────────────────────────────────────────────────────────────────────────────
describe('getGroupQuerySchema', () => {
  it('accepts an empty query object', () => {
    const { error } = validate(getGroupQuerySchema, {});
    expect(error).toBeUndefined();
  });

  it('accepts orderBy alone', () => {
    const { error } = validate(getGroupQuerySchema, { orderBy: 'name' });
    expect(error).toBeUndefined();
  });

  it('accepts offset alone', () => {
    const { error } = validate(getGroupQuerySchema, { offset: 1 });
    expect(error).toBeUndefined();
  });

  it('accepts limit alone', () => {
    const { error } = validate(getGroupQuerySchema, { limit: 10 });
    expect(error).toBeUndefined();
  });

  it('accepts all three fields at once', () => {
    const { error } = validate(getGroupQuerySchema, { orderBy: '-updated', offset: 5, limit: 20 });
    expect(error).toBeUndefined();
  });

  it('rejects limit: 0 — minimum is 1', () => {
    const { error } = validate(getGroupQuerySchema, { limit: 0 });
    expect(error).toBeDefined();
  });

  it('rejects offset: 0 — minimum is 1', () => {
    const { error } = validate(getGroupQuerySchema, { offset: 0 });
    expect(error).toBeDefined();
  });

  it('rejects unknown fields', () => {
    const { error } = validate(getGroupQuerySchema, { owner: 'admin@test.com' });
    expect(error).toBeDefined();
  });
});
