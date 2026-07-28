import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, insertRows, dailySeries } from "../src/db.js";
import { METRICS } from "../src/metrics.js";

/**
 * Health Auto Export delivers a day either as one cumulative total or, at
 * finer granularity, as a series of buckets. Steps must sum across buckets;
 * rates must not.
 */
function seedDay(db, name, values, day = "2026-07-27") {
  const base = Date.parse(day + "T00:00:00Z");
  insertRows(db, values.map((qty, i) => ({
    name, day, ts: base + i * 3600000, qty, units: "x", source: "test", extra: null
  })));
}

test("cumulative metrics sum their buckets", () => {
  const db = openDb(":memory:");
  seedDay(db, "step_count", [900, 900, 900, 900, 900, 900, 900, 900]);
  assert.equal(dailySeries(db, "step_count", 3650, "sum")[0].qty, 7200);
});

test("taking the last bucket would report an hour as the whole day", () => {
  const db = openDb(":memory:");
  seedDay(db, "step_count", [900, 900, 900, 900, 900, 900, 900, 900]);
  assert.equal(dailySeries(db, "step_count", 3650, "last")[0].qty, 900);
});

test("a single daily total is unchanged by summing", () => {
  const db = openDb(":memory:");
  seedDay(db, "step_count", [7200]);
  assert.equal(dailySeries(db, "step_count", 3650, "sum")[0].qty, 7200);
  assert.equal(dailySeries(db, "step_count", 3650, "last")[0].qty, 7200);
});

test("rates take the latest reading rather than summing", () => {
  const db = openDb(":memory:");
  seedDay(db, "resting_heart_rate", [70, 72, 74, 77]);
  assert.equal(dailySeries(db, "resting_heart_rate", 3650, "last")[0].qty, 77);
});

test("only cumulative metrics are marked to sum", () => {
  const summed = Object.entries(METRICS)
    .filter(([, m]) => m.aggregate === "sum").map(([k]) => k).sort();
  assert.deepEqual(summed, [
    "active_energy", "apple_exercise_time", "apple_stand_hour", "apple_stand_time",
    "basal_energy_burned", "step_count", "time_in_daylight", "walking_running_distance"
  ]);
  // Rates and levels must never be summed.
  for (const n of ["resting_heart_rate", "heart_rate_variability", "walking_speed",
                   "blood_oxygen_saturation", "sleep_analysis", "respiratory_rate"]) {
    assert.notEqual(METRICS[n].aggregate, "sum", `${n} must not be summed`);
  }
});
