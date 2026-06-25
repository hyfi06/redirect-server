const BOT_PATTERNS = [
  /\.php$/i,
  /^\/\./,
  /^\/wp-/i,
  /\.(asp|aspx|jsp|cgi)$/i,
];

function botReject(req, res, next) {
  if (BOT_PATTERNS.some((pattern) => pattern.test(req.path))) {
    // 404 not 403: avoid signaling to the scanner that the path was recognized
    return res.status(404).end();
  }
  next();
}

module.exports = botReject;
