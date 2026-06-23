#!/usr/bin/env node

'use strict';

const { spawnSync } = require('child_process');
const https = require('https');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run a gcloud command and return its stdout as a string.
 * Throws if the command exits with a non-zero code.
 * @param {string[]} args
 * @returns {string}
 */
function gcloud(args) {
  const result = spawnSync('gcloud', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    const msg = result.stderr || result.stdout || `gcloud ${args[0]} failed`;
    throw new Error(msg.trim());
  }
  return result.stdout.trim();
}

/**
 * Make an HTTPS request and return parsed JSON.
 * @param {string} method
 * @param {string} url
 * @param {string} accessToken
 * @param {object|null} body
 * @returns {Promise<object>}
 */
function httpsRequest(method, url, accessToken, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ _raw: data, _status: res.statusCode });
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Normalize a fields array so comparisons are field-order-insensitive to
 * Firestore's own field additions (`__name__`) and strip `density`.
 * Returns a canonical JSON string for use as a map key.
 * @param {object[]} fields
 * @returns {string}
 */
function normalizeFields(fields) {
  const filtered = fields
    .filter((f) => f.fieldPath !== '__name__')
    .map((f) => {
      const entry = { fieldPath: f.fieldPath };
      if (f.order) entry.order = f.order;
      if (f.arrayConfig) entry.arrayConfig = f.arrayConfig;
      return entry;
    });
  return JSON.stringify(filtered);
}

/**
 * Build a stable identity key for a composite index.
 * @param {{ collectionGroup: string, queryScope: string, fields: object[] }} index
 * @returns {string}
 */
function indexKey(index) {
  return `${index.collectionGroup}|${index.queryScope}|${normalizeFields(index.fields)}`;
}

/**
 * Build the `gcloud firestore indexes composite create` argument list.
 * @param {{ collectionGroup: string, queryScope: string, fields: object[] }} index
 * @param {string} project
 * @returns {string[]}
 */
function buildCreateArgs(index, project) {
  const args = [
    'firestore',
    'indexes',
    'composite',
    'create',
    `--collection-group=${index.collectionGroup}`,
    `--query-scope=${index.queryScope}`,
    `--project=${project}`,
  ];
  for (const field of index.fields) {
    if (field.arrayConfig) {
      args.push(`--field-config=field-path=${field.fieldPath},array-config=${field.arrayConfig}`);
    } else {
      args.push(`--field-config=field-path=${field.fieldPath},order=${field.order}`);
    }
  }
  return args;
}

/**
 * Prompt the user for a yes/no answer.
 * @param {string} question
 * @returns {Promise<boolean>}
 */
function confirm(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

/**
 * Canonical key for a field override index entry: queryScope + fields.
 * Used to diff desired vs. existing field index configs.
 * @param {{ queryScope: string, order?: string, arrayConfig?: string }} entry
 * @returns {string}
 */
function fieldIndexEntryKey(entry) {
  const field = entry.order ? `order:${entry.order}` : `arrayConfig:${entry.arrayConfig}`;
  return `${entry.queryScope}|${field}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const force = process.argv.includes('--force');

  // 1. Read desired config
  const indexesFile = path.resolve(__dirname, '..', 'firestore.indexes.json');
  if (!fs.existsSync(indexesFile)) {
    console.error(`ERROR: ${indexesFile} not found.`);
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(indexesFile, 'utf8'));
  const desiredComposite = config.indexes || [];
  const desiredFieldOverrides = config.fieldOverrides || [];

  // 2. Resolve active GCP project
  let project;
  try {
    project = gcloud(['config', 'get-value', 'project']);
  } catch (err) {
    console.error(`ERROR: Could not read GCP project: ${err.message}`);
    process.exit(1);
  }
  if (!project) {
    console.error('ERROR: No active GCP project set. Run: gcloud config set project PROJECT_ID');
    process.exit(1);
  }
  console.log(`Using GCP project: ${project}`);

  // 3. ── Composite indexes ──────────────────────────────────────────────────

  let existing = [];
  try {
    const raw = gcloud([
      'firestore', 'indexes', 'composite', 'list',
      `--project=${project}`, '--format=json',
    ]);
    existing = JSON.parse(raw).map((idx) => {
      // gcloud returns collectionGroup as null; extract it from the resource name.
      // name pattern: projects/{p}/databases/(default)/collectionGroups/{cg}/indexes/{id}
      if (!idx.collectionGroup && idx.name) {
        const match = idx.name.match(/collectionGroups\/([^/]+)\/indexes\//);
        if (match) return { ...idx, collectionGroup: match[1] };
      }
      return idx;
    });
  } catch (err) {
    console.error(`ERROR: Could not list Firestore indexes: ${err.message}`);
    process.exit(1);
  }

  const desiredMap = new Map(desiredComposite.map((idx) => [indexKey(idx), idx]));
  const existingMap = new Map(existing.map((idx) => [indexKey(idx), idx]));

  const toCreate = desiredComposite.filter((idx) => !existingMap.has(indexKey(idx)));
  const toDelete = existing.filter((idx) => !desiredMap.has(indexKey(idx)));

  if (toCreate.length === 0 && toDelete.length === 0) {
    console.log('Composite indexes: up to date.');
  } else {
    for (const idx of toCreate) {
      const label = `${idx.collectionGroup} (${idx.queryScope}) [${idx.fields.map((f) => f.fieldPath).join(', ')}]`;
      console.log(`Creating composite index: ${label}`);
      try {
        gcloud(buildCreateArgs(idx, project));
        console.log('  Created.');
      } catch (err) {
        console.error(`  ERROR: ${err.message}`);
        process.exit(1);
      }
    }

    if (toDelete.length > 0) {
      console.log(`\nObsolete composite indexes (${toDelete.length}):`);
      for (const idx of toDelete) {
        const label = `${idx.collectionGroup} (${idx.queryScope}) [${idx.fields.map((f) => f.fieldPath).join(', ')}]`;
        console.log(`  - ${label}  (${idx.name})`);
      }
      let proceed = force;
      if (!force) proceed = await confirm('\nDelete these obsolete indexes?');
      if (proceed) {
        for (const idx of toDelete) {
          const label = `${idx.collectionGroup} (${idx.queryScope}) [${idx.fields.map((f) => f.fieldPath).join(', ')}]`;
          console.log(`Deleting composite index: ${label}`);
          try {
            gcloud(['firestore', 'indexes', 'composite', 'delete', idx.name, `--project=${project}`, '--quiet']);
            console.log('  Deleted.');
          } catch (err) {
            console.error(`  ERROR: ${err.message}`);
            process.exit(1);
          }
        }
      } else {
        console.log('Skipping deletion of obsolete indexes.');
      }
    }
  }

  // 4. ── Field overrides ───────────────────────────────────────────────────
  if (desiredFieldOverrides.length === 0) return;

  let accessToken;
  try {
    accessToken = gcloud(['auth', 'application-default', 'print-access-token']);
  } catch (err) {
    console.error(`ERROR: Could not get access token: ${err.message}`);
    process.exit(1);
  }

  const firestoreBase = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/collectionGroups`;

  for (const override of desiredFieldOverrides) {
    const { collectionGroup, fieldPath, indexes: desiredEntries } = override;
    const label = `${collectionGroup}.${fieldPath}`;
    const url = `${firestoreBase}/${collectionGroup}/fields/${fieldPath}`;

    const current = await httpsRequest('GET', url, accessToken);
    const currentEntries = (current.indexConfig?.indexes || []).map((e) => ({
      queryScope: e.queryScope,
      ...(e.fields[0].order ? { order: e.fields[0].order } : { arrayConfig: e.fields[0].arrayConfig }),
      state: e.state,
    }));

    const currentKeys = new Set(currentEntries.map(fieldIndexEntryKey));
    const desiredKeys = new Set(desiredEntries.map(fieldIndexEntryKey));
    const needsUpdate = desiredEntries.some((e) => !currentKeys.has(fieldIndexEntryKey(e)));
    const hasExtraReady = currentEntries
      .filter((e) => e.state === 'READY')
      .some((e) => !desiredKeys.has(fieldIndexEntryKey(e)));

    if (!needsUpdate && !hasExtraReady) {
      const states = [...new Set(currentEntries.map((e) => e.state))].join(', ');
      console.log(`Field override ${label}: up to date (${states}).`);
      continue;
    }

    console.log(`Updating field override: ${label}`);

    // Build the PATCH body: convert desired entries to Firestore index objects
    const indexObjects = desiredEntries.map((e) => ({
      queryScope: e.queryScope,
      fields: [
        {
          fieldPath,
          ...(e.order ? { order: e.order } : { arrayConfig: e.arrayConfig }),
        },
      ],
    }));

    const result = await httpsRequest('PATCH', url, accessToken, { indexConfig: { indexes: indexObjects } });
    if (result.error) {
      console.error(`  ERROR: ${result.error.message}`);
      process.exit(1);
    }
    console.log(`  Operation started: ${result.name}`);
    console.log('  Index is building — check state with: npm run indexes');
  }
}

main().catch((err) => {
  console.error(`Unexpected error: ${err.message}`);
  process.exit(1);
});
