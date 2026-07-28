/**
 * Turns raw readings into something the plate can say out loud.
 *
 * Two regimes, because a fresh install has no history:
 *
 *   Cold start — fewer than MIN_DAYS of data. Values are judged against a
 *   broad population reference range. Enough to render the figure on day one.
 *
 *   Warm — once there is real history, the reference range stops mattering
 *   and everything is judged against your own rolling baseline. "Unusual"
 *   means unusual for you, which is the only definition worth acting on.
 */

import { METRICS, metricInfo } from "./metrics.js";
import { dailySeries } from "./db.js";

const MIN_DAYS = 7;        // below this, personal baselines are noise
const WINDOW = 90;         // rolling baseline window
const UNUSUAL_Z = 2;       // standard deviations before the plate speaks up

const clamp01 = v => Math.max(0, Math.min(1, v));
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;

function stdev(a, mu) {
  if (a.length < 2) return 0;
  return Math.sqrt(a.reduce((s, v) => s + (v - mu) ** 2, 0) / (a.length - 1));
}

/**
 * Where a value sits on a 0..1 scale where 1 is good. Drives organ colour
 * and fill on the figure. Metrics with no direction return null — the plate
 * shows them without judging them.
 */
function position(value, info, baseline) {
  if (value == null) return null;

  // Score against the full physiological span, not the ideal band. Scoring
  // against the ideal pins every out-of-range value to zero, and a figure
  // where every organ reads "worst" tells you nothing about which one to
  // work on. [worst, best] encodes direction, so no branch on `better`.
  if (info.scale) {
    const [worst, best] = info.scale;
    return clamp01((value - worst) / (best - worst));
  }

  // No reference range but a personal baseline: score by how close to normal.
  if (baseline?.sd > 0) {
    const z = Math.abs((value - baseline.mean) / baseline.sd);
    return clamp01(1 - z / 3);
  }
  return null;
}

function describe(value, info, baseline, z) {
  const unit = info.unit ? ` ${info.unit}` : "";
  const v = value?.toFixed(info.precision ?? 1);

  if (baseline && baseline.n >= MIN_DAYS && z != null) {
    const delta = value - baseline.mean;
    const dir = delta > 0 ? "above" : "below";
    const good = info.better
      ? (info.better === "high") === (delta > 0)
      : null;
    const mag = Math.abs(delta).toFixed(info.precision ?? 1);

    if (Math.abs(z) >= UNUSUAL_Z) {
      return {
        status: good === false ? "unusual" : good === true ? "good" : "watch",
        text: `${v}${unit} — ${mag}${unit} ${dir} your ${baseline.n}-day mean.`
      };
    }
    return {
      status: "normal",
      text: `${v}${unit}, in line with your ${baseline.n}-day mean of ${baseline.mean.toFixed(info.precision ?? 1)}.`
    };
  }

  // Cold start: say so plainly rather than pretending to know your normal.
  if (info.reference) {
    const [lo, hi] = info.reference;
    if (value < lo) return { status: info.better === "high" ? "watch" : "good",
                             text: `${v}${unit} — below the typical ${lo}–${hi} range.` };
    if (value > hi) return { status: info.better === "low" ? "watch" : "good",
                             text: `${v}${unit} — above the typical ${lo}–${hi} range.` };
    return { status: "normal", text: `${v}${unit} — within the typical ${lo}–${hi} range.` };
  }

  return { status: "unknown", text: `${v}${unit}.` };
}

/** Recent 7 days against the 7 before them. More readable than a slope. */
function trend(values) {
  if (values.length < 10) return null;
  const recent = values.slice(-7);
  const prior = values.slice(-14, -7);
  if (prior.length < 3) return null;
  return mean(recent) - mean(prior);
}

export function summarize(db, name) {
  const info = metricInfo(name);
  const series = dailySeries(db, name, WINDOW, info.aggregate ?? "last");
  if (!series.length) return null;

  const latest = series[series.length - 1];
  const history = series.slice(0, -1).map(r => r.qty).filter(v => v != null);

  let baseline = null;
  if (history.length >= 3) {
    const mu = mean(history);
    baseline = { mean: mu, sd: stdev(history, mu), n: history.length };
  }

  const z = baseline && baseline.sd > 0 && latest.qty != null
    ? (latest.qty - baseline.mean) / baseline.sd
    : null;

  const { status, text } = describe(latest.qty, info, baseline, z);

  return {
    name,
    label: info.label,
    organ: info.organ,
    unit: info.unit,
    precision: info.precision,
    blurb: info.blurb,
    improve: info.improve ?? null,
    better: info.better,
    reference: info.reference,
    scale: info.scale ?? null,
    value: latest.qty,
    extra: latest.extra,
    day: latest.day,
    ts: latest.ts,
    baseline,
    z,
    status,
    note: text,
    position: position(latest.qty, info, baseline),
    trend: trend(series.map(r => r.qty).filter(v => v != null)),
    series: series.map(r => ({ day: r.day, qty: r.qty }))
  };
}

export function overview(db, names) {
  const out = {};
  for (const name of names) {
    const s = summarize(db, name);
    if (s) out[name] = s;
  }
  return out;
}

/**
 * The marginal notes. Only genuine outliers earn one — a plate that
 * comments on everything is a plate you stop reading.
 */
export function notes(summaries) {
  const rank = { unusual: 0, watch: 1, good: 2 };
  return Object.values(summaries)
    .filter(s => s.status === "unusual" || s.status === "watch" || s.status === "good")
    .filter(s => s.baseline ? Math.abs(s.z ?? 0) >= UNUSUAL_Z : true)
    .sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9))
    .slice(0, 4)
    .map(s => ({ name: s.name, label: s.label, organ: s.organ, status: s.status, text: s.note }));
}

/**
 * Smoking state. Modelled from the logged quit date — the watch cannot see
 * a cigarette, and the plate should never imply otherwise.
 */
export function smokingState(db, quitTs) {
  if (!quitTs) return null;
  const days = (Date.now() - quitTs) / 86400000;
  if (days < 0) return null;
  return {
    days,
    tar: 1 / (1 + (days / 85) ** 2),   // cilia recovery over ~9 months
    modelled: true
  };
}

export const CONSTANTS = { MIN_DAYS, WINDOW, UNUSUAL_Z };
