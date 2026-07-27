#!/usr/bin/env node
/**
 * Loads Health Auto Export JSON files straight into the database, bypassing
 * the HTTP layer. Use it to seed history from saved exports, or to heal a
 * gap after the Mac has been asleep.
 *
 *   node src/import.js ~/Downloads/HealthAutoExport-*.json
 *   node src/import.js ~/Downloads/health-exports/
 *
 * Re-importing the same file is safe: rows upsert on (metric, timestamp).
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { normalize } from "./normalize.js";
import { openDb, insertRows, logIngest, dayCount, metricNames } from "./db.js";

async function expand(paths) {
  const files = [];
  for (const p of paths) {
    const s = await stat(p).catch(() => null);
    if (!s) {
      console.warn(`  skipping ${p} — not found`);
      continue;
    }
    if (s.isDirectory()) {
      const entries = await readdir(p);
      files.push(...entries.filter(f => f.endsWith(".json")).map(f => join(p, f)));
    } else {
      files.push(p);
    }
  }
  return files;
}

const args = process.argv.slice(2);
if (!args.length) {
  console.error("usage: node src/import.js <file.json|directory> [...]");
  process.exit(1);
}

const db = openDb(process.env.DB_PATH || "./data/corpus.sqlite");
const files = await expand(args);

if (!files.length) {
  console.error("No .json files found in those paths.");
  process.exit(1);
}

let total = 0;
let totalSkipped = 0;

for (const file of files) {
  try {
    const raw = await readFile(file, "utf8");
    const { rows, skipped } = normalize(JSON.parse(raw));
    insertRows(db, rows);
    logIngest(db, {
      rows: rows.length, skipped: skipped.length,
      bytes: Buffer.byteLength(raw), remote: "import"
    });
    total += rows.length;
    totalSkipped += skipped.length;
    console.log(`  ${file}: ${rows.length} readings${skipped.length ? `, ${skipped.length} skipped` : ""}`);
    for (const s of skipped.slice(0, 5)) console.log(`      ${s.name}: ${s.reason}`);
  } catch (err) {
    console.error(`  ${file}: FAILED — ${err.message}`);
  }
}

console.log(`\n${total} readings imported${totalSkipped ? `, ${totalSkipped} skipped` : ""}.`);
console.log(`Database now holds ${dayCount(db)} day(s) across ${metricNames(db).length} metrics.`);
