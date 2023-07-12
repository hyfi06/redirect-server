const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config');

const notFoundHandler = require('./middleware/notFound.handler');
const { wrapErrors, errorHandler } = require('./middleware/error.handler');

const redirectRoute = require('./redirect/routes');
const rootRouter = require('./routes/root');
const { apiV1 } = require('./api');

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
// apiV1(app);
redirectRoute(app);

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
