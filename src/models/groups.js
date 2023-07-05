class Group {
  /**
   *
   * @param {Object} data
   * @param {string[]} data.users
   * @param {Date|FirebaseFirestore.Timestamp} data.created
   * @param {Date|FirebaseFirestore.Timestamp} data.updated
   */
  constructor(data) {
    const { id, users, created, updated } = data;
    this.id = id;
    this.users = users || [];
    if (created) this.created = created.toDate?.() || created;
    this.updated = updated?.toDate?.() || updated || new Date();
  }
}

module.exports = Group;
