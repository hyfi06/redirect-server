const config = require('../config');
const FirestoreLib = require('../lib/firestore');

class RedirectorService {
  constructor() {
    this.collection = config.dbCollection;
    this.db = new FirestoreLib();
  }

  async getUrl(urn) {
    const data = await this.db.get(this.collection, urn);
    return data.url;
  }
}

module.exports = RedirectorService;
