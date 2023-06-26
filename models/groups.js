class Groups {
  constructor(data) {
    const { users, created, updated } = data;
    this.users = users || [];
    if (created) this.created = created;
    this.updated = updated || new Date();
  }
}
