/**
 * Normalizes Health Auto Export payloads into flat rows.
 *
 * The export format has three shapes that a naive parser gets wrong:
 *
 *   1. Dates look like "2026-07-27 00:00:00 +0530" — a space instead of the
 *      ISO "T", and a UTC offset with no colon. Date.parse() is unreliable
 *      on this across engines, so we parse it ourselves.
 *   2. Most points are {qty, date, source}, but heart_rate carries
 *      {Avg, Min, Max} with capitalised keys and no qty at all.
 *   3. sleep_analysis is a whole object per night — stage hours, plus
 *      separate inBed and asleep windows.
 *
 * Anything we don't recognise still gets stored, so a metric added later
 * in the app doesn't need a code change here to be captured.
 */

/** "2026-07-27 00:00:00 +0530" -> epoch ms, or null if unparseable. */
export function parseHAEDate(s) {
  if (typeof s !== "string") return null;
  const m = s.trim().match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?\s*([+-])(\d{2}):?(\d{2})$/
  );
  if (m) {
    const [, y, mo, d, h, mi, sec, sign, oh, om] = m;
    const utc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec);
    const offsetMin = (+oh * 60 + +om) * (sign === "-" ? -1 : 1);
    return utc - offsetMin * 60000;
  }
  // Fall back for plain ISO strings, which some app versions emit.
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/**
 * Local calendar day the reading belongs to.
 *
 * We keep the day the *device* reported rather than recomputing it in the
 * server's timezone. A 03:24 bedtime in +0530 belongs to that date, and a
 * server running in UTC would otherwise shove it into the previous day.
 */
export function localDayOf(s) {
  const m = typeof s === "string" && s.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/** kJ is what the watch reports; kcal is what humans read. */
const UNIT_CONVERSIONS = {
  kJ: { to: "kcal", f: v => v / 4.184 }
};

function convert(qty, units) {
  const c = UNIT_CONVERSIONS[units];
  return c && typeof qty === "number"
    ? { qty: c.f(qty), units: c.to, originalUnits: units }
    : { qty, units, originalUnits: null };
}

const num = v => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Pulls the primary scalar out of a data point. Which field that is
 * depends on the metric, so the special cases live here rather than
 * being scattered through the callers.
 */
function extractPoint(name, point) {
  if (name === "heart_rate") {
    const avg = num(point.Avg) ?? num(point.avg) ?? num(point.qty);
    return {
      qty: avg,
      extra: { min: num(point.Min) ?? num(point.min), max: num(point.Max) ?? num(point.max) }
    };
  }

  if (name === "sleep_analysis") {
    // totalSleep is the headline; the stage breakdown is what makes the
    // brain panel interesting, so keep all of it.
    const staged =
      (num(point.core) ?? 0) + (num(point.deep) ?? 0) + (num(point.rem) ?? 0);
    const total = num(point.totalSleep) ?? (staged > 0 ? staged : null);
    return {
      qty: total,
      extra: {
        core: num(point.core),
        deep: num(point.deep),
        rem: num(point.rem),
        awake: num(point.awake),
        inBed: num(point.inBed),
        asleep: num(point.asleep),
        sleepStart: point.sleepStart ?? null,
        sleepEnd: point.sleepEnd ?? null,
        inBedStart: point.inBedStart ?? null,
        inBedEnd: point.inBedEnd ?? null
      }
    };
  }

  return { qty: num(point.qty), extra: null };
}

/**
 * payload -> [{ name, day, ts, qty, units, source, extra }]
 *
 * `ts` is the exact instant, `day` the local calendar date. Rows are keyed
 * on (name, ts) downstream, so re-sending the same day is an upsert and
 * switching the app to hourly granularity just produces more rows.
 */
export function normalize(payload) {
  const metrics = payload?.data?.metrics;
  if (!Array.isArray(metrics)) {
    throw new Error("payload has no data.metrics array");
  }

  const rows = [];
  const skipped = [];

  for (const metric of metrics) {
    const name = metric?.name;
    if (!name || !Array.isArray(metric.data)) {
      skipped.push({ name: name ?? "(unnamed)", reason: "no data array" });
      continue;
    }

    for (const point of metric.data) {
      const ts = parseHAEDate(point.date);
      const day = localDayOf(point.date);
      if (ts == null || day == null) {
        skipped.push({ name, reason: `unparseable date: ${point.date}` });
        continue;
      }

      const { qty, extra } = extractPoint(name, point);
      if (qty == null && extra == null) {
        skipped.push({ name, reason: "no numeric value" });
        continue;
      }

      const c = convert(qty, metric.units);
      rows.push({
        name,
        day,
        ts,
        qty: c.qty,
        units: c.units ?? null,
        originalUnits: c.originalUnits,
        source: point.source || null,
        extra
      });
    }
  }

  return { rows, skipped, workouts: payload?.data?.workouts ?? [] };
}
