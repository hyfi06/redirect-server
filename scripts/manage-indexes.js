#!/usr/bin/env node

'use strict';

const { execSync, spawnSync } = require('child_process');
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
      // drop density and any other internal keys
      return entry;
    });
  return JSON.stringify(filtered);
}

/**
 * Build a stable identity key for an index: collectionGroup + queryScope + fields.
 * @param {{ collectionGroup: string, queryScope: string, fields: object[] }} index
 * @returns {string}
 */
function indexKey(index) {
  return `${index.collectionGroup}|${index.queryScope}|${normalizeFields(index.fields)}`;
}

/**
 * Build the `gcloud firestore indexes composite create` argument list for a
 * desired index.
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
      args.push(
        `--field-config=field-path=${field.fieldPath},array-config=${field.arrayConfig}`
      );
    } else {
      args.push(
        `--field-config=field-path=${field.fieldPath},order=${field.order}`
      );
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
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const force = process.argv.includes('--force');

  // 1. Read the desired indexes from the repo's firestore.indexes.json
  const indexesFile = path.resolve(__dirname, '..', 'firestore.indexes.json');
  if (!fs.existsSync(indexesFile)) {
    console.error(`ERROR: ${indexesFile} not found.`);
    process.exit(1);
  }
  const desired = JSON.parse(fs.readFileSync(indexesFile, 'utf8')).indexes;

  // 2. Resolve the active GCP project
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

  // 3. Fetch the existing composite indexes from Firestore
  let existing = [];
  try {
    const raw = gcloud([
      'firestore',
      'indexes',
      'composite',
      'list',
      `--project=${project}`,
      '--format=json',
    ]);
    existing = JSON.parse(raw);
  } catch (err) {
    console.error(`ERROR: Could not list Firestore indexes: ${err.message}`);
    process.exit(1);
  }

  // 4. Build lookup maps
  const desiredMap = new Map(desired.map((idx) => [indexKey(idx), idx]));

  // Treat CREATING as already-existing — don't recreate in-progress indexes.
  const existingMap = new Map(
    existing.map((idx) => [indexKey(idx), idx])
  );

  // 5. Identify indexes to create (in desired but not in existing)
  const toCreate = desired.filter((idx) => !existingMap.has(indexKey(idx)));

  // 6. Identify obsolete indexes (in existing but not in desired)
  const toDelete = existing.filter((idx) => !desiredMap.has(indexKey(idx)));

  if (toCreate.length === 0 && toDelete.length === 0) {
    console.log('All indexes are up to date. Nothing to do.');
    return;
  }

  // 7. Create missing indexes
  for (const idx of toCreate) {
    const label = `${idx.collectionGroup} (${idx.queryScope}) [${idx.fields
      .map((f) => f.fieldPath)
      .join(', ')}]`;
    console.log(`Creating index: ${label}`);
    try {
      gcloud(buildCreateArgs(idx, project));
      console.log(`  Created.`);
    } catch (err) {
      console.error(`  ERROR creating index: ${err.message}`);
      process.exit(1);
    }
  }

  // 8. Delete obsolete indexes
  if (toDelete.length > 0) {
    console.log(`\nObsolete indexes (${toDelete.length}):`);
    for (const idx of toDelete) {
      const label = `${idx.collectionGroup} (${idx.queryScope}) [${idx.fields
        .map((f) => f.fieldPath)
        .join(', ')}]`;
      console.log(`  - ${label}  (${idx.name})`);
    }

    let proceed = force;
    if (!force) {
      proceed = await confirm('\nDelete these obsolete indexes?');
    }

    if (proceed) {
      for (const idx of toDelete) {
        const label = `${idx.collectionGroup} (${idx.queryScope}) [${idx.fields
          .map((f) => f.fieldPath)
          .join(', ')}]`;
        console.log(`Deleting index: ${label}`);
        try {
          gcloud([
            'firestore',
            'indexes',
            'composite',
            'delete',
            idx.name,
            `--project=${project}`,
            '--quiet',
          ]);
          console.log('  Deleted.');
        } catch (err) {
          console.error(`  ERROR deleting index: ${err.message}`);
          process.exit(1);
        }
      }
    } else {
      console.log('Skipping deletion of obsolete indexes.');
    }
  }
}

main().catch((err) => {
  console.error(`Unexpected error: ${err.message}`);
  process.exit(1);
});
