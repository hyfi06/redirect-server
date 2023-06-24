const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const config = require('../config');

const notFoundHandler = require('../middleware/notFoundHandler');
const { wrapErrors, errorHandler } = require('../middleware/errorHandler');

const redirectorApi = require('./routes/redirect');

const app = express();
app.use(cors());
app.use(helmet());
app.use(express.json());

redirectorApi(app);

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
