/**
 * SQLite store, on the built-in node:sqlite — no npm dependency, and the
 * whole database is one file you can delete to start over.
 *
 * Readings are keyed on (name, ts), so re-sending a day is an upsert rather
 * than a duplicate. That matters because Health Auto Export re-posts the
 * current day repeatedly as it accumulates, and because backfilling a date
 * range after the Mac has been asleep should heal the gap, not double it.
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS readings (
  name   TEXT    NOT NULL,
  ts     INTEGER NOT NULL,
  day    TEXT    NOT NULL,
  qty    REAL,
  units  TEXT,
  source TEXT,
  extra  TEXT,
  PRIMARY KEY (name, ts)
);
CREATE INDEX IF NOT EXISTS idx_readings_day  ON readings(day);
CREATE INDEX IF NOT EXISTS idx_readings_name ON readings(name, ts DESC);

CREATE TABLE IF NOT EXISTS ingests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at INTEGER NOT NULL,
  rows        INTEGER NOT NULL,
  skipped     INTEGER NOT NULL,
  bytes       INTEGER,
  remote      TEXT
);

-- Smoking is logged by hand. No sensor here produces these rows.
CREATE TABLE IF NOT EXISTS events (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  ts   INTEGER NOT NULL,
  kind TEXT    NOT NULL,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts DESC);

-- Vasculature: where you are on the map and what you have spent getting there.
CREATE TABLE IF NOT EXISTS game (
  key   TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS visits (
  node       TEXT PRIMARY KEY,
  visited_at INTEGER NOT NULL
);
`;

export function openDb(path = "./data/corpus.sqlite") {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

export function insertRows(db, rows) {
  const stmt = db.prepare(`
    INSERT INTO readings (name, ts, day, qty, units, source, extra)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(name, ts) DO UPDATE SET
      qty = excluded.qty, units = excluded.units,
      source = excluded.source, extra = excluded.extra, day = excluded.day
  `);
  const run = db.prepare("BEGIN");
  run.run();
  try {
    for (const r of rows) {
      stmt.run(r.name, r.ts, r.day, r.qty, r.units, r.source,
               r.extra ? JSON.stringify(r.extra) : null);
    }
    db.prepare("COMMIT").run();
  } catch (err) {
    db.prepare("ROLLBACK").run();
    throw err;
  }
  return rows.length;
}

export function logIngest(db, { rows, skipped, bytes, remote }) {
  db.prepare(
    "INSERT INTO ingests (received_at, rows, skipped, bytes, remote) VALUES (?,?,?,?,?)"
  ).run(Date.now(), rows, skipped, bytes ?? null, remote ?? null);
}

const parseExtra = r => ({ ...r, extra: r.extra ? JSON.parse(r.extra) : null });

/** Most recent reading for every metric present in the database. */
export function latestAll(db) {
  const rows = db.prepare(`
    SELECT r.* FROM readings r
    JOIN (SELECT name, MAX(ts) AS ts FROM readings GROUP BY name) m
      ON r.name = m.name AND r.ts = m.ts
    ORDER BY r.name
  `).all();
  return rows.map(parseExtra);
}

/** One value per day for a metric — the last reading of each day. */
export function dailySeries(db, name, days = 90) {
  const since = Date.now() - days * 86400000;
  const rows = db.prepare(`
    SELECT r.day, r.qty, r.units, r.extra, r.ts FROM readings r
    JOIN (SELECT day, MAX(ts) AS ts FROM readings WHERE name = ? GROUP BY day) m
      ON r.day = m.day AND r.ts = m.ts
    WHERE r.name = ? AND r.ts >= ?
    ORDER BY r.day ASC
  `).all(name, name, since);
  return rows.map(parseExtra);
}

/** Intraday points, for when the app is set to finer than daily granularity. */
export function intraday(db, name, day) {
  return db.prepare(
    "SELECT ts, qty, units, extra FROM readings WHERE name = ? AND day = ? ORDER BY ts ASC"
  ).all(name, day).map(parseExtra);
}

export function metricNames(db) {
  return db.prepare("SELECT DISTINCT name FROM readings ORDER BY name")
           .all().map(r => r.name);
}

export function dayCount(db) {
  return db.prepare("SELECT COUNT(DISTINCT day) AS n FROM readings").get()?.n ?? 0;
}

export function addEvent(db, kind, note = null, ts = Date.now()) {
  db.prepare("INSERT INTO events (ts, kind, note) VALUES (?,?,?)").run(ts, kind, note);
}

export function lastEvent(db, kind) {
  return db.prepare("SELECT * FROM events WHERE kind = ? ORDER BY ts DESC LIMIT 1").get(kind);
}

export function countEvents(db, kind, sinceTs = 0) {
  return db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind = ? AND ts >= ?")
           .get(kind, sinceTs)?.n ?? 0;
}

export function ingestStats(db) {
  return db.prepare(
    "SELECT COUNT(*) AS n, MAX(received_at) AS last FROM ingests"
  ).get();
}
