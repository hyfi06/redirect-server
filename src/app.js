const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const passport = require('passport');
const config = require('./config');

const { log } = require('./utils/logger');
const clickCounter = require('./utils/click-counter');
const notFoundHandler = require('./middleware/notFound.handler');
const { wrapErrors, errorHandler } = require('./middleware/error.handler');

const redirectRoute = require('./redirect/routes');
const rootRouter = require('./routes/root');
const healthRouter = require('./routes/health');
const { apiV1 } = require('./api');
const botReject = require('./middleware/bot-reject.middleware');

const app = express();
app.use(
  cors({
    origin: config.cors,
  })
);

app.use(helmet());
app.use(express.json());

/* Routers */
rootRouter(app);
app.use(passport.initialize());
apiV1(app);
healthRouter(app);
app.use(botReject);
redirectRoute(app);

// Catch 404
app.use(notFoundHandler);

// error middleware
app.use(wrapErrors);
app.use(errorHandler);

process.on('SIGTERM', async () => {
  log('INFO', 'SIGTERM received — flushing click counters before shutdown');
  const timeout = setTimeout(() => {
    log('WARNING', 'click-counter flush timed out — forcing exit');
    process.exit(1);
  }, 10000);
  await clickCounter.flushAll();
  clearTimeout(timeout);
  process.exit(0);
});

app.listen(config.port, function () {
  log('INFO', `Server listening on port ${config.port}`);
});
