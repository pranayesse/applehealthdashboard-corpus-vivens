import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize, parseHAEDate, localDayOf } from "../src/normalize.js";

/**
 * Fixture mirrors the real Health Auto Export shape — key order shuffled,
 * offset dates, the heart_rate and sleep_analysis special cases — but the
 * numbers are invented. Real health data does not belong in a repository.
 */
const fixture = {
  data: {
    metrics: [
      { name: "active_energy", units: "kJ",
        data: [{ qty: 1000, date: "2026-07-27 00:00:00 +0530", source: "Watch" }] },
      { units: "count/min", name: "heart_rate",
        data: [{ date: "2026-07-27 00:00:00 +0530", Avg: 80.5, Max: 120, Min: 50, source: "Watch" }] },
      { name: "sleep_analysis", units: "hr",
        data: [{
          date: "2026-07-27 00:00:00 +0530", totalSleep: 7.5,
          core: 4.5, deep: 1.0, rem: 2.0, awake: 0.4, inBed: 0, asleep: 0,
          sleepStart: "2026-07-27 01:00:00 +0530", sleepEnd: "2026-07-27 08:30:00 +0530",
          source: "Watch"
        }] },
      { name: "step_count", units: "count",
        data: [{ qty: 4200, date: "2026-07-27 00:00:00 +0530", source: "Watch|iPhone" }] },
      { name: "future_metric_we_do_not_know", units: "widgets",
        data: [{ qty: 3, date: "2026-07-27 00:00:00 +0530", source: "" }] }
    ]
  }
};

test("parses the offset date format without relying on Date.parse", () => {
  // 00:00 at +0530 is 18:30 UTC the previous day.
  assert.equal(
    new Date(parseHAEDate("2026-07-27 00:00:00 +0530")).toISOString(),
    "2026-07-26T18:30:00.000Z"
  );
  assert.equal(
    new Date(parseHAEDate("2026-07-27 00:00:00 -0800")).toISOString(),
    "2026-07-27T08:00:00.000Z"
  );
  assert.equal(parseHAEDate("nonsense"), null);
  assert.equal(parseHAEDate(undefined), null);
});

test("keeps the device's calendar day rather than the server's", () => {
  // A UTC server would call this the 26th; the watch says the 27th.
  assert.equal(localDayOf("2026-07-27 00:00:00 +0530"), "2026-07-27");
  assert.equal(localDayOf("2026-07-27 03:24:09 +0530"), "2026-07-27");
});

test("normalizes every metric in the payload", () => {
  const { rows, skipped } = normalize(fixture);
  assert.equal(skipped.length, 0);
  assert.equal(rows.length, 5);
});

test("converts kJ to kcal", () => {
  const { rows } = normalize(fixture);
  const e = rows.find(r => r.name === "active_energy");
  assert.equal(e.units, "kcal");
  assert.equal(e.originalUnits, "kJ");
  assert.ok(Math.abs(e.qty - 239.0) < 0.5, `expected ~239 kcal, got ${e.qty}`);
});

test("reads heart rate from Avg and keeps the day's range", () => {
  const { rows } = normalize(fixture);
  const hr = rows.find(r => r.name === "heart_rate");
  assert.equal(hr.qty, 80.5);
  assert.deepEqual(hr.extra, { min: 50, max: 120 });
});

test("keeps the sleep stage breakdown", () => {
  const { rows } = normalize(fixture);
  const s = rows.find(r => r.name === "sleep_analysis");
  assert.equal(s.qty, 7.5);
  assert.equal(s.extra.deep, 1.0);
  assert.equal(s.extra.rem, 2.0);
  assert.equal(s.extra.sleepStart, "2026-07-27 01:00:00 +0530");
});

test("stores unknown metrics instead of dropping them", () => {
  const { rows } = normalize(fixture);
  assert.ok(rows.find(r => r.name === "future_metric_we_do_not_know"));
});

test("derives total sleep from stages when totalSleep is absent", () => {
  const { rows } = normalize({
    data: { metrics: [{
      name: "sleep_analysis", units: "hr",
      data: [{ date: "2026-07-27 00:00:00 +0530", core: 4, deep: 1, rem: 2 }]
    }] }
  });
  assert.equal(rows[0].qty, 7);
});

test("reports bad dates rather than silently dropping them", () => {
  const { rows, skipped } = normalize({
    data: { metrics: [{ name: "step_count", units: "count",
      data: [{ qty: 10, date: "not a date" }] }] }
  });
  assert.equal(rows.length, 0);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /unparseable date/);
});

test("rejects a payload with no metrics array", () => {
  assert.throws(() => normalize({ data: {} }), /no data.metrics/);
});
