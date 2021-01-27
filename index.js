const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config');
const redirectorApi = require('./routes/redirector');

const app = express();
app.use(cors());
app.use(helmet());
app.use(express.json());

redirectorApi(app);

app.listen(config.port, function () {
  if (config.dev) {
    console.log(`Listenig http://localhost:${config.port}/`);
  }
});
