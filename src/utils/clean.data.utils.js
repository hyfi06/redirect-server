/**
 *
 * @param {Object} data
 * @returns {Object}
 */
function cleanDocObject(data) {
  Object.entries(data)
    .filter((entry) => {
      const [_, value] = entry;
      return value === undefined || value === {};
    })
    .forEach((entry) => {
      const [key, _] = entry;
      delete data[key];
    });
  return data;
}

function deleteRegData(data) {
  delete data.id;
  delete data.created;
  delete data.updated;
  return data;
}

module.exports = {
  deleteRegData,
  cleanDocObject,
};
