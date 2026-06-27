/**
 * Removes undefined values and empty plain objects from data in-place.
 * @param {Object} data
 * @returns {Object}
 */
function cleanDocObject(data) {
  Object.entries(data)
    .filter((entry) => {
      const [_, value] = entry;
      return (
        value === undefined ||
        (value !== null &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          Object.keys(value).length === 0)
      );
    })
    .forEach((entry) => {
      const [key, _] = entry;
      delete data[key];
    });
  return data;
}

/**
 * Removes id, created, and updated fields from data in-place.
 * @param {object} data
 * @returns {object}
 */
function deleteRegData(data) {
  delete data.id;
  delete data.created;
  delete data.updated;
  return data;
}

/**
 * @param {import('@google-cloud/firestore').Timestamp} ts
 * @returns {Date}
 */
function parseTimestamp(ts) {
  return new Date(ts.toMillis());
}

/**
 * @param {import('@google-cloud/firestore').Timestamp|null|undefined} ts
 * @returns {Date|null}
 */
function parseOptionalTimestamp(ts) {
  return ts ? new Date(ts.toMillis()) : null;
}

module.exports = { deleteRegData, cleanDocObject, parseTimestamp, parseOptionalTimestamp };
