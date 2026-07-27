/**
 * Vasculature — a traversal of your own circulatory system, moved by walking.
 *
 * You start at the heart. Every step you take after starting the game banks
 * against the vessel you are travelling down. Organs are gated on measures
 * you have to actually improve to pass, not on grinding, and a logged
 * cigarette adds tar to the vessel you are in, which costs steps to clear.
 *
 * The map is anatomically ordered — heart to arch to carotid to brain, aorta
 * down through the iliac to the foot — so the route teaches you something
 * about the body it is drawn from.
 */

import { dailySeries, lastEvent, countEvents } from "./db.js";
import { summarize } from "./baselines.js";

/**
 * Node positions are laid out on a 560x900 grid matching the plate's figure,
 * so the map reads as the same body you see on the front page.
 *
 * `gate` is a metric the traveller must satisfy to enter. Thresholds sit a
 * little beyond a sedentary starting point: each is a nudge, not a wall.
 */
export const NODES = {
  cor:            { label: "Cor", en: "Heart", at: [292, 296], organ: "heart",
                    note: "Where every journey starts and ends." },
  truncus:        { label: "Truncus Pulmonalis", en: "Pulmonary trunk", at: [268, 258],
                    short: "Truncus", side: "end", dy: -9 },
  pulmo:          { label: "Pulmones", en: "Lungs", at: [236, 270], organ: "lungs",
                    short: "Pulmones", side: "end", dy: 12,
                    gate: { metric: "blood_oxygen_saturation", op: ">=", value: 96 },
                    note: "Oxygen is loaded here. Smoke competes for the same seats." },
  arcus:          { label: "Arcus Aortae", en: "Aortic arch", at: [283, 250],
                    short: "Arcus", side: "start", dy: -10 },
  carotis:        { label: "Arteria Carotis", en: "Carotid", at: [287, 196], short: "Carotis" },
  cerebrum:       { label: "Cerebrum", en: "Brain", at: [280, 92], organ: "brain",
                    gate: { metric: "sleep_analysis", op: ">=", value: 7 },
                    note: "Reachable only on a rested body." },
  subclavia:      { label: "Arteria Subclavia", en: "Subclavian", at: [340, 262], short: "Subclavia" },
  brachialis:     { label: "Arteria Brachialis", en: "Brachial", at: [372, 380], short: "Brachialis" },
  manus:          { label: "Manus", en: "Hand", at: [358, 520],
                    note: "The far edge of the upper circuit." },
  thoracica:      { label: "Aorta Thoracica", en: "Thoracic aorta", at: [281, 360],
                    short: "Aorta thor.", side: "end" },
  abdominalis:    { label: "Aorta Abdominalis", en: "Abdominal aorta", at: [280, 430],
                    short: "Aorta abd.", side: "end" },
  renalis:        { label: "Arteria Renalis", en: "Renal", at: [318, 412],
                    short: "Renalis", side: "start", dy: -6,
                    gate: { metric: "resting_heart_rate", op: "<=", value: 82 },
                    note: "The kidneys take a fifth of every heartbeat." },
  iliaca:         { label: "Arteria Iliaca", en: "Iliac", at: [280, 470], short: "Iliaca", side: "end" },
  femoralis:      { label: "Arteria Femoralis", en: "Femoral", at: [312, 566], organ: "legs",
                    short: "Femoralis",
                    gate: { metric: "walking_speed", op: ">=", value: 4.0 },
                    note: "The body's largest artery below the waist." },
  poplitea:       { label: "Arteria Poplitea", en: "Popliteal", at: [318, 686], short: "Poplitea" },
  tibialis:       { label: "Arteria Tibialis", en: "Tibial", at: [313, 784], short: "Tibialis" },
  pes:            { label: "Pes", en: "Foot", at: [306, 852], short: "Pes",
                    gate: { metric: "heart_rate_variability", op: ">=", value: 30 },
                    note: "The furthest point from the heart. The last place blood reaches." }
};

/** [from, to, steps]. Costs rise with distance from the heart. */
export const EDGES = [
  ["cor", "truncus", 1200],
  ["truncus", "pulmo", 1800],
  ["cor", "arcus", 1500],
  ["arcus", "carotis", 2500],
  ["carotis", "cerebrum", 4000],
  ["arcus", "subclavia", 2800],
  ["subclavia", "brachialis", 4500],
  ["brachialis", "manus", 6000],
  ["arcus", "thoracica", 3000],
  ["thoracica", "abdominalis", 4000],
  ["abdominalis", "renalis", 3500],
  ["abdominalis", "iliaca", 5000],
  ["iliaca", "femoralis", 6500],
  ["femoralis", "poplitea", 8000],
  ["poplitea", "tibialis", 9000],
  ["tibialis", "pes", 11000]
];

const START = "cor";
const TAR_STEPS = 2500;   // what one logged cigarette costs to clear

export function neighbours(node) {
  const out = [];
  for (const [a, b, cost] of EDGES) {
    if (a === node) out.push({ to: b, cost });
    else if (b === node) out.push({ to: a, cost });
  }
  return out;
}

/* ── persistence ─────────────────────────────────────────── */

const get = (db, k) =>
  db.prepare("SELECT value FROM game WHERE key = ?").get(k)?.value ?? null;

const put = (db, k, v) =>
  db.prepare("INSERT INTO game (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(k, String(v));

export function ensureStarted(db) {
  if (!get(db, "started_day")) {
    // Steps only count from the day you begin, or existing history would
    // teleport you across the map before you had walked anywhere.
    put(db, "started_day", new Date().toISOString().slice(0, 10));
    put(db, "position", START);
    put(db, "spent", 0);
    db.prepare("INSERT OR IGNORE INTO visits (node, visited_at) VALUES (?,?)")
      .run(START, Date.now());
  }
}

/** Steps recorded on or after the day the game began. */
function bankedSteps(db, startedDay) {
  const rows = dailySeries(db, "step_count", 3650);
  return rows
    .filter(r => r.day >= startedDay && r.qty != null)
    .reduce((s, r) => s + r.qty, 0);
}

function visited(db) {
  return db.prepare("SELECT node, visited_at FROM visits ORDER BY visited_at").all();
}

/* ── gates ───────────────────────────────────────────────── */

function checkGate(db, gate) {
  if (!gate) return { open: true };
  const s = summarize(db, gate.metric);
  if (!s || s.value == null) {
    return { open: false, reason: "no reading yet", gate, current: null };
  }
  const open = gate.op === ">=" ? s.value >= gate.value : s.value <= gate.value;
  return { open, gate, current: s.value, label: s.label, unit: s.unit };
}

/* ── state ───────────────────────────────────────────────── */

export function gameState(db) {
  ensureStarted(db);

  const startedDay = get(db, "started_day");
  const position = get(db, "position") ?? START;
  const spent = Number(get(db, "spent") ?? 0);

  const banked = bankedSteps(db, startedDay);
  const cigarettes = countEvents(db, "cigarette", Date.parse(startedDay + "T00:00:00"));
  const tar = cigarettes * TAR_STEPS;
  const available = Math.max(0, banked - spent - tar);

  const seen = new Set(visited(db).map(v => v.node));

  const routes = neighbours(position).map(({ to, cost }) => {
    const node = NODES[to];
    const gate = checkGate(db, node.gate);
    return {
      to,
      label: node.label,
      en: node.en,
      cost,
      visited: seen.has(to),
      reachable: available >= cost && gate.open,
      // rounded, or a fractional step total surfaces as "62.491 more steps"
      shortBy: Math.max(0, Math.round(cost - available)),
      gate: node.gate ? gate : null
    };
  });

  return {
    startedDay,
    position,
    positionLabel: NODES[position].label,
    positionEn: NODES[position].en,
    banked: Math.round(banked),
    spent: Math.round(spent),
    tar,
    cigarettes,
    available: Math.round(available),
    visited: [...seen],
    unlockedOrgans: [...seen].map(n => NODES[n]?.organ).filter(Boolean),
    total: Object.keys(NODES).length,
    routes,
    nodes: NODES,
    edges: EDGES
  };
}

export function travel(db, to) {
  ensureStarted(db);
  const state = gameState(db);
  const route = state.routes.find(r => r.to === to);

  if (!route) return { ok: false, error: "no vessel connects those two points" };
  if (route.gate && !route.gate.open) {
    const g = route.gate;
    return {
      ok: false,
      error: `${NODES[to].label} is closed. Needs ${g.label} ${g.gate.op} ${g.gate.value}${g.unit ? " " + g.unit : ""}` +
             (g.current != null ? `, currently ${g.current.toFixed(1)}` : "")
    };
  }
  if (state.available < route.cost) {
    return { ok: false, error: `${Math.round(route.cost - state.available)} more steps needed` };
  }

  put(db, "spent", state.spent + route.cost);
  put(db, "position", to);
  db.prepare("INSERT OR IGNORE INTO visits (node, visited_at) VALUES (?,?)").run(to, Date.now());

  return { ok: true, arrived: to, label: NODES[to].label, state: gameState(db) };
}
