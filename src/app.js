const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config');
const path = require('path');

const notFoundHandler = require('./middleware/notFoundHandler');
const { wrapErrors, errorHandler } = require('./middleware/errorHandler');

const redirectRouter = require('./routes/redirect');

const app = express();
app.use(cors());
app.use(helmet());
app.use(express.json());

app.use(express.static(path.join(__dirname, './public')));

/* Routers */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/home/index.html'));
});

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
