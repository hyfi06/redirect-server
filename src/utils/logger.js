function log(severity, message, data = {}) {
  if (process.env.NODE_ENV === 'production') {
    process.stdout.write(JSON.stringify({ severity, message, ...data }) + '\n');
  } else if (process.env.NODE_ENV !== 'test') {
    const extra = Object.keys(data).length ? data : '';
    console.log(`[${severity}] ${message}`, extra);
  }
}

module.exports = { log };
