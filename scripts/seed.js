#!/usr/bin/env node
/**
 * Generates synthetic history so the plate has something to show before you
 * have months of real data.
 *
 * It anchors on whatever is already in your database — your real resting
 * rate, your real step count — and walks backwards with plausible drift and
 * day-to-day noise. The result behaves like your body rather than like a
 * textbook, which is the only way to judge whether the visual encoding works.
 *
 *   node test/seed.js 60        # 60 days ending today
 *
 * Seeded rows are marked source="synthetic" so you can delete them later:
 *   DELETE FROM readings WHERE source = 'synthetic';
 */

import "../src/env.js";
import { openDb, insertRows, latestAll } from "../src/db.js";

const days = Number(process.argv[2] || 45);
const db = openDb(process.env.DB_PATH || "./data/corpus.sqlite");

// Anchor on real readings where we have them; these fallbacks only apply
// to metrics the database has never seen.
const FALLBACK = {
  resting_heart_rate: 84, heart_rate: 86, heart_rate_variability: 27,
  walking_heart_rate_average: 96, respiratory_rate: 21.6,
  blood_oxygen_saturation: 97.3, breathing_disturbances: 1.1,
  sleep_analysis: 6.8, apple_sleeping_wrist_temperature: 35.26,
  step_count: 2153, walking_running_distance: 1.39, walking_speed: 3.8,
  walking_step_length: 56.7, walking_asymmetry_percentage: 1,
  walking_double_support_percentage: 30.8, active_energy: 310,
  apple_exercise_time: 3, time_in_daylight: 41, apple_stand_hour: 13,
  physical_effort: 3.26, basal_energy_burned: 1914, apple_stand_time: 58
};

const UNITS = {
  resting_heart_rate: "count/min", heart_rate: "count/min",
  heart_rate_variability: "ms", walking_heart_rate_average: "count/min",
  respiratory_rate: "count/min", blood_oxygen_saturation: "%",
  breathing_disturbances: "count", sleep_analysis: "hr",
  apple_sleeping_wrist_temperature: "degC", step_count: "count",
  walking_running_distance: "km", walking_speed: "km/hr",
  walking_step_length: "cm", walking_asymmetry_percentage: "%",
  walking_double_support_percentage: "%", active_energy: "kcal",
  apple_exercise_time: "min", time_in_daylight: "min",
  apple_stand_hour: "count", physical_effort: "kcal/hr·kg",
  basal_energy_burned: "kcal", apple_stand_time: "min"
};

// Fractional day-to-day noise, and drift per day going backwards in time.
// Positive drift means the metric was higher in the past.
const SHAPE = {
  resting_heart_rate:        { noise: 0.03, drift:  0.02 },
  heart_rate:                { noise: 0.05, drift:  0.02 },
  heart_rate_variability:    { noise: 0.18, drift: -0.03 },
  walking_heart_rate_average:{ noise: 0.04, drift:  0.02 },
  respiratory_rate:          { noise: 0.06, drift:  0.01 },
  blood_oxygen_saturation:   { noise: 0.01, drift:  0 },
  breathing_disturbances:    { noise: 0.40, drift:  0.01 },
  sleep_analysis:            { noise: 0.15, drift:  0 },
  apple_sleeping_wrist_temperature: { noise: 0.004, drift: 0 },
  step_count:                { noise: 0.45, drift:  0 },
  walking_running_distance:  { noise: 0.45, drift:  0 },
  walking_speed:             { noise: 0.07, drift:  0 },
  walking_step_length:       { noise: 0.05, drift:  0 },
  walking_asymmetry_percentage: { noise: 0.60, drift: 0 },
  walking_double_support_percentage: { noise: 0.06, drift: 0 },
  active_energy:             { noise: 0.35, drift:  0 },
  apple_exercise_time:       { noise: 0.80, drift:  0 },
  time_in_daylight:          { noise: 0.50, drift:  0 },
  apple_stand_hour:          { noise: 0.15, drift:  0 },
  physical_effort:           { noise: 0.20, drift:  0 },
  basal_energy_burned:       { noise: 0.03, drift:  0 },
  apple_stand_time:          { noise: 0.25, drift:  0 }
};

const anchors = { ...FALLBACK };
for (const r of latestAll(db)) {
  if (r.qty != null) anchors[r.name] = r.qty;
}

// Deterministic noise, so re-running produces the same history.
let s = 1337;
const rand = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const gauss = () => (rand() + rand() + rand() + rand() - 2) / 2;

const rows = [];
const today = new Date();
today.setHours(0, 0, 0, 0);

for (let back = days; back >= 1; back--) {
  const d = new Date(today.getTime() - back * 86400000);
  const day = d.toISOString().slice(0, 10);
  const ts = d.getTime();
  const weekend = d.getDay() === 0 || d.getDay() === 6;

  for (const [name, base] of Object.entries(anchors)) {
    const shape = SHAPE[name] ?? { noise: 0.1, drift: 0 };
    let v = base * (1 + shape.drift * back / 30) * (1 + gauss() * shape.noise);

    // People walk differently at weekends; without this every day looks alike.
    if (weekend && ["step_count", "walking_running_distance", "active_energy"].includes(name)) {
      v *= 1.35;
    }
    if (name === "blood_oxygen_saturation") v = Math.min(100, v);
    if (name === "walking_asymmetry_percentage") v = Math.max(0, v);

    const extra =
      name === "heart_rate" ? { min: Math.round(v * 0.64), max: Math.round(v * 1.32) }
      : name === "sleep_analysis" ? {
          core: v * 0.65, deep: v * 0.11, rem: v * 0.24, awake: 0.5 + rand() * 0.4
        }
      : null;

    rows.push({
      name, day, ts,
      qty: Number(v.toFixed(4)),
      units: UNITS[name] ?? null,
      source: "synthetic",
      extra
    });
  }
}

insertRows(db, rows);
console.log(`Seeded ${rows.length} synthetic readings across ${days} days.`);
console.log(`Anchored on ${Object.keys(anchors).length} metrics from your database.`);
console.log(`Remove later with:  DELETE FROM readings WHERE source = 'synthetic';`);
