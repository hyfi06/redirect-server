const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config');

const notFoundHandler = require('./middleware/notFoundHandler');
const { wrapErrors, errorHandler } = require('./middleware/errorHandler');

const redirectRouter = require('./routes/redirect');
const rootRouter = require('./routes/root');

const app = express();
app.use(
  cors({
    origin: config.cors.split(','),
  })
);

app.use(helmet());
app.use(express.json());

/* Routers */
rootRouter(app);
redirectRouter(app);

// Catch 404
app.use(notFoundHandler);

// error middleware
app.use(wrapErrors);
app.use(errorHandler);

app.listen(config.port, function () {
  if (config.dev) {
    console.log(`Listening http://localhost:${config.port}/`);
  } else {
    console.log(`Server listening on port ${config.port}`);
  }
});
