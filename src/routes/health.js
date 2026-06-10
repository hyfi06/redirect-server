const FireStoreAdapter = require('../lib/firestore');
const config = require('../config');

const db = new FireStoreAdapter(config.firestore.collections.redirects);

function healthRouter(app) {
  app.get('/_ah/health', async (req, res) => {
    try {
      await db.collection.limit(1).get();
      res.status(200).json({ status: 'ok' });
    } catch (e) {
      res.status(503).json({ status: 'error', message: e.message });
    }
  });
}

module.exports = healthRouter;
