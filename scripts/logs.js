#!/usr/bin/env node

'use strict';

const { spawnSync } = require('child_process');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run a gcloud command and return its stdout as a string.
 * Exits the process if the command fails or gcloud is not found.
 * @param {string[]} args
 * @returns {string}
 */
function gcloud(args) {
  const result = spawnSync('gcloud', args, { encoding: 'utf8' });
  if (result.error) {
    console.error('ERROR: gcloud is not available. Install the Google Cloud SDK and try again.');
    process.exit(1);
  }
  if (result.status !== 0) {
    const msg = (result.stderr || result.stdout || `gcloud ${args[0]} failed`).trim();
    console.error(`ERROR: ${msg}`);
    process.exit(1);
  }
  return result.stdout.trim();
}

/**
 * Extract a human-readable message from a Cloud Logging entry.
 * @param {object} entry
 * @returns {string}
 */
function extractMessage(entry) {
  if (entry.textPayload) return entry.textPayload.trim();
  if (entry.jsonPayload) {
    if (entry.jsonPayload.message) return String(entry.jsonPayload.message).trim();
    return JSON.stringify(entry.jsonPayload);
  }
  if (entry.protoPayload) return JSON.stringify(entry.protoPayload);
  return '(no message)';
}

/**
 * Format an ISO 8601 timestamp as YYYY-MM-DD HH:MM:SS (UTC).
 * @param {string} ts
 * @returns {string}
 */
function formatTimestamp(ts) {
  return new Date(ts).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const showAll = process.argv.includes('--all');

let project;
try {
  project = gcloud(['config', 'get-value', 'project']);
} catch {
  // gcloud() already prints the error and exits; this branch is unreachable.
}
if (!project) {
  console.error('ERROR: No active GCP project set. Run: gcloud config set project PROJECT_ID');
  process.exit(1);
}

const filter = showAll
  ? 'resource.type="gae_app"'
  : 'resource.type="gae_app" severity>=ERROR';

const raw = gcloud([
  'logging', 'read', filter,
  '--limit=100',
  `--project=${project}`,
  '--format=json',
]);

let entries;
try {
  entries = JSON.parse(raw);
} catch {
  console.error('ERROR: Could not parse gcloud output as JSON.');
  process.exit(1);
}

if (!Array.isArray(entries) || entries.length === 0) {
  console.log('No log entries found.');
  process.exit(0);
}

for (const entry of entries) {
  const ts = formatTimestamp(entry.timestamp || '');
  const severity = (entry.severity || 'DEFAULT').padEnd(8);
  const message = extractMessage(entry);
  console.log(`[${ts}] [${severity}] ${message}`);
}
