const redirectRouter = require('./redirect.router');

function redirectRoute(app) {
  app.use('/', redirectRouter);
}

module.exports = redirectRoute;
