#!/usr/bin/env node
/**
 * The local service. Receives Health Auto Export pushes, stores them, and
 * serves the plate. Binds to your LAN so the phone can reach it; nothing
 * is exposed beyond your own network.
 *
 *   POST /ingest      Health Auto Export posts here. Bearer token required.
 *   POST /event       Log a cigarette, a craving, or set your quit date.
 *   GET  /api/plate   Everything the figure needs, in one call.
 *   GET  /api/metric/:name
 *   GET  /api/health  Liveness and last-ingest time.
 *   GET  /            The plate itself.
 */

import "./env.js";   // must come first: everything below reads process.env
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize as normPath } from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { networkInterfaces } from "node:os";

import { normalize } from "./normalize.js";
import {
  openDb, insertRows, logIngest, latestAll, metricNames,
  dayCount, addEvent, lastEvent, countEvents, ingestStats, intraday
} from "./db.js";
import { overview, notes, smokingState, CONSTANTS } from "./baselines.js";
import { METRICS, ORGANS, PLATE_ORDER } from "./metrics.js";
import { gameState, travel } from "./game.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PUBLIC = join(ROOT, "public");

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const DB_PATH = process.env.DB_PATH || join(ROOT, "data", "corpus.sqlite");
const TOKEN = process.env.INGEST_TOKEN || "";
const QUIT_DATE = process.env.QUIT_DATE || "";
const MAX_BODY = 12 * 1024 * 1024;   // a month of backfill fits easily

if (!TOKEN) {
  console.error("Refusing to start: INGEST_TOKEN is not set.");
  console.error("Anyone on your network could otherwise write to your health record.");
  console.error("Copy .env.example to .env and set a long random value.");
  process.exit(1);
}

const db = openDb(DB_PATH);

/* ── helpers ─────────────────────────────────────────────── */

const json = (res, code, body) => {
  const s = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(s),
    "cache-control": "no-store"
  });
  res.end(s);
};

/** Constant-time compare so the token can't be guessed by timing. */
function tokenOk(header) {
  const given = String(header || "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("payload too large"), { code: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const quitTs = QUIT_DATE ? Date.parse(QUIT_DATE) : null;

/** First non-internal IPv4 address — what the phone should post to. */
function lanAddress() {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) return a.address;
    }
  }
  return null;
}

/**
 * The setup page shows the ingest token so it can be copied to the phone,
 * and the service listens on the LAN — so the token is only ever sent to
 * a request originating from this machine. Anyone else on the Wi-Fi gets
 * the page without the secret.
 */
function isLoopback(req) {
  const a = req.socket.remoteAddress ?? "";
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
}

/* ── the payload the plate consumes ──────────────────────── */

function buildPlate() {
  const present = metricNames(db);
  const summaries = overview(db, present);
  const logged = lastEvent(db, "quit");
  const quit = logged?.ts ?? (Number.isNaN(quitTs) ? null : quitTs);

  return {
    generated: Date.now(),
    days: dayCount(db),
    coldStart: dayCount(db) < CONSTANTS.MIN_DAYS,
    organs: ORGANS,
    plateOrder: PLATE_ORDER.filter(n => summaries[n]),
    metrics: summaries,
    notes: notes(summaries),
    smoking: smokingState(db, quit),
    cigarettesToday: countEvents(db, "cigarette", Date.now() - 86400000),
    cravings: countEvents(db, "craving", Date.now() - 86400000),
    ingest: ingestStats(db)
  };
}

/* ── routes ──────────────────────────────────────────────── */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png"
};

async function serveStatic(res, urlPath) {
  const rel = normPath(urlPath === "/" ? "/index.html" : urlPath).replace(/^(\.\.[/\\])+/, "");
  const file = join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) {   // defence against ../ traversal
    return json(res, 403, { error: "forbidden" });
  }
  try {
    const buf = await readFile(file);
    res.writeHead(200, {
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-cache"
    });
    res.end(buf);
  } catch {
    json(res, 404, { error: "not found" });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const path = url.pathname;

  try {
    if (req.method === "POST" && path === "/ingest") {
      if (!tokenOk(req.headers.authorization || url.searchParams.get("token"))) {
        return json(res, 401, { error: "bad or missing token" });
      }
      const raw = await readBody(req);
      let payload;
      try {
        payload = JSON.parse(raw.toString("utf8"));
      } catch {
        return json(res, 400, { error: "body is not valid JSON" });
      }

      const { rows, skipped } = normalize(payload);
      insertRows(db, rows);
      logIngest(db, {
        rows: rows.length, skipped: skipped.length, bytes: raw.length,
        remote: req.socket.remoteAddress
      });
      console.log(`[ingest] ${rows.length} readings, ${skipped.length} skipped, ${raw.length}b`);
      return json(res, 200, { ok: true, stored: rows.length, skipped });
    }

    if (req.method === "GET" && path === "/api/game") {
      return json(res, 200, gameState(db));
    }

    if (req.method === "POST" && path === "/api/game/travel") {
      // Travelling and logging are driven by the UI in this Mac's browser,
      // which has no token, so loopback is accepted. Ingest stays strict.
      if (!isLoopback(req) && !tokenOk(req.headers.authorization)) {
        return json(res, 401, { error: "bad or missing token" });
      }
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const result = travel(db, String(body.to || ""));
      return json(res, result.ok ? 200 : 400, result);
    }

    if (req.method === "POST" && path === "/event") {
      if (!isLoopback(req) && !tokenOk(req.headers.authorization || url.searchParams.get("token"))) {
        return json(res, 401, { error: "bad or missing token" });
      }
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const kind = String(body.kind || "");
      if (!["cigarette", "craving", "quit"].includes(kind)) {
        return json(res, 400, { error: "kind must be cigarette, craving or quit" });
      }
      const ts = body.at ? Date.parse(body.at) : Date.now();
      addEvent(db, kind, body.note ?? null, Number.isNaN(ts) ? Date.now() : ts);
      return json(res, 200, { ok: true });
    }

    if (req.method === "GET" && path === "/api/plate") {
      return json(res, 200, buildPlate());
    }

    if (req.method === "GET" && path.startsWith("/api/metric/")) {
      const name = decodeURIComponent(path.slice("/api/metric/".length));
      const day = url.searchParams.get("day");
      return json(res, 200, {
        name,
        info: METRICS[name] ?? null,
        points: day ? intraday(db, name, day) : null,
        summary: overview(db, [name])[name] ?? null
      });
    }

    if (req.method === "GET" && path === "/api/setup") {
      const stats = ingestStats(db);
      const local = isLoopback(req);
      return json(res, 200, {
        local,
        // withheld from anyone but this machine
        token: local ? TOKEN : null,
        address: lanAddress(),
        port: PORT,
        boundToLan: HOST === "0.0.0.0",
        ingests: stats.n,
        lastIngest: stats.last,
        days: dayCount(db),
        metrics: metricNames(db).length,
        quitDateSet: Boolean(quitTs && !Number.isNaN(quitTs))
      });
    }

    if (req.method === "GET" && path === "/setup") {
      return serveStatic(res, "/setup.html");
    }

    if (req.method === "GET" && path === "/game") {
      return serveStatic(res, "/game.html");
    }

    if (req.method === "GET" && path === "/api/health") {
      const stats = ingestStats(db);
      return json(res, 200, {
        ok: true,
        days: dayCount(db),
        metrics: metricNames(db).length,
        ingests: stats.n,
        lastIngest: stats.last,
        latest: latestAll(db).length
      });
    }

    if (req.method === "GET") return serveStatic(res, path);
    json(res, 405, { error: "method not allowed" });
  } catch (err) {
    console.error("[error]", err);
    json(res, err.code === 413 ? 413 : 500, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Corpus Vivens listening on http://${HOST}:${PORT}`);
  console.log(`  database  ${DB_PATH}`);
  console.log(`  days      ${dayCount(db)}`);
  console.log(`  point Health Auto Export at  http://<this-mac>.local:${PORT}/ingest`);
});
