/**
 * E2E HTTP client wrapper.
 * All test requests go through here so base URL and common headers are centralized.
 * `redirect: 'manual'` prevents fetch from following redirects — callers inspect the
 * 302 status themselves (or use rawGet for the redirect catch-all tests).
 */
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';

/**
 * @param {string} method
 * @param {string} path
 * @param {{ body?: object, token?: string }} [opts]
 * @returns {Promise<{ status: number, data: object|null, headers: Headers }>}
 */
async function request(method, path, { body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data, headers: res.headers };
}

module.exports = { request, BASE_URL };
