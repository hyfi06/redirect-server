const BOT_PATTERNS = [
  /\.php$/i,
  /^\/\./,
  /^\/wp-/i,
  /\.(asp|aspx|jsp|cgi)$/i,
];

function botReject(req, res, next) {
  if (BOT_PATTERNS.some((pattern) => pattern.test(req.path))) {
    return res.status(404).end();
  }
  next();
}

module.exports = botReject;
