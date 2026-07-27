/**
 * Binds the figure to /api/plate.
 *
 * Everything drawn here comes from a reading your watch actually took. The
 * one exception is tar in the lungs, which is modelled from a logged quit
 * date and is labelled as such wherever it appears.
 */

import {
  TORSO, LEG, ARM, MIRROR, BRAIN, LUNG_L, LUNG_R, HEART,
  VESSELS, TAGS, LEG_GAUGE
} from "./anatomy.js";

const NS = "http://www.w3.org/2000/svg";
const $ = s => document.querySelector(s);
const el = id => document.getElementById(id);
const S = v => v.toFixed(1);
const clamp01 = v => Math.max(0, Math.min(1, v));

/* ── static geometry ─────────────────────────────────────── */

const setD = (id, d) => el(id).setAttribute("d", d);
setD("torso", TORSO); setD("torsoh", TORSO);
setD("legR", LEG); setD("legRh", LEG); setD("clipLegRp", LEG);
setD("legL", LEG); setD("legLh", LEG); setD("clipLegLp", LEG);
setD("armR", ARM); setD("armRh", ARM);
setD("armL", ARM); setD("armLh", ARM);
for (const id of ["legL", "legLh", "clipLegLp", "armL", "armLh"]) {
  el(id).setAttribute("transform", MIRROR);
}
setD("brainBody", BRAIN);
setD("lungTissueL", LUNG_L); setD("lungClipL", LUNG_L);
setD("lungTissueR", LUNG_R); setD("lungClipR", LUNG_R);
setD("heartBody", HEART);

const beds = el("vesselBeds"), pulse = el("vesselPulse");
for (const d of VESSELS) {
  for (const [cls, parent] of [["vessel-bed", beds], ["arterial", pulse]]) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    p.setAttribute("class", cls);
    parent.appendChild(p);
  }
}

const mk = (tag, attrs, text) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  return e;
};

const tagLayer = el("tags");
for (const t of TAGS) {
  const elbow = t.side === "end" ? t.to[0] + 30 : t.to[0] - 30;
  const g = document.createElementNS(NS, "g");
  g.append(
    mk("path", { class: "leader", d: `M ${t.at[0]} ${t.at[1]} L ${elbow} ${t.to[1]} L ${t.to[0]} ${t.to[1]}` }),
    mk("circle", { class: "leader-dot", cx: t.at[0], cy: t.at[1], r: 2.2 }),
    mk("text", { class: "tag-name", x: t.to[0], y: t.to[1] - 23, "text-anchor": t.side }, t.name),
    mk("text", { class: "tag-val", x: t.to[0], y: t.to[1] - 4, "text-anchor": t.side, id: `tv-${t.id}` }),
    mk("text", { class: "tag-unit", x: t.to[0], y: t.to[1] + 10, "text-anchor": t.side, id: `tu-${t.id}` })
  );
  tagLayer.appendChild(g);
}

/* ── data ────────────────────────────────────────────────── */

let PLATE = null;
let DAYS = [];          // every calendar day we hold readings for
let cursor = 0;         // index into DAYS

/** Value of a metric on a given day, or the nearest earlier day. */
function valueOn(metric, day) {
  const s = PLATE.metrics[metric];
  if (!s?.series?.length) return null;
  let found = null;
  for (const p of s.series) {
    if (p.day <= day) found = p;
    else break;
  }
  return found?.qty ?? null;
}

/** 0..1 where 1 is good, using the metric's full physiological scale. */
function positionOf(metric, value) {
  const s = PLATE.metrics[metric];
  if (value == null || !s?.scale) return null;
  const [worst, best] = s.scale;
  return clamp01((value - worst) / (best - worst));
}

const fmt = (metric, v) => {
  const s = PLATE.metrics[metric];
  if (v == null) return "—";
  return metric === "step_count" ? Math.round(v).toLocaleString() : v.toFixed(s?.precision ?? 1);
};

/* Colour ramp from carmine (poor) to a healthy rose, by position. */
function tissueColour(pos) {
  if (pos == null) return "var(--rose)";
  const l = 42 + pos * 22;        // lightness climbs as things improve
  const c = 34 - pos * 12;        // and saturation calms down
  return `lch(${l}% ${c} 18)`;
}

/* ── render ──────────────────────────────────────────────── */

function renderFigure(day) {
  const hr = valueOn("resting_heart_rate", day) ?? valueOn("heart_rate", day);
  const hrv = valueOn("heart_rate_variability", day);
  const resp = valueOn("respiratory_rate", day);
  const spo2 = valueOn("blood_oxygen_saturation", day);
  const sleep = valueOn("sleep_analysis", day);
  const steps = valueOn("step_count", day);
  const asym = valueOn("walking_asymmetry_percentage", day) ?? 0;

  // The heart keeps your measured rate. The lungs keep your measured
  // breathing rate. Both are real readings, not decoration.
  const root = document.documentElement;
  root.style.setProperty("--beat", hr ? `${(60 / hr * 1000).toFixed(0)}ms` : "900ms");
  root.style.setProperty("--breath", resp ? `${(60 / resp * 1000).toFixed(0)}ms` : "3000ms");

  el("heartBody").style.opacity = String(0.55 + (positionOf("heart_rate_variability", hrv) ?? 0.5) * 0.45);

  const lungPos = positionOf("blood_oxygen_saturation", spo2);
  for (const id of ["lungTissueL", "lungTissueR"]) {
    el(id).setAttribute("fill", tissueColour(lungPos));
  }

  // Tar is modelled from your quit date, never measured.
  el("sootLayer").setAttribute("opacity", S(Math.min(PLATE.smoking?.tar ?? 0, 0.84)));

  el("brainBody").setAttribute("opacity", S(0.45 + (positionOf("sleep_analysis", sleep) ?? 0.4) * 0.5));

  // Steps fill each leg. Gait asymmetry is a real measurement of how
  // unevenly the two legs carry you, so the two gauges differ by it.
  const base = positionOf("step_count", steps) ?? 0;
  const skew = clamp01(asym / 100);
  const fill = (rectId, lineId, frac) => {
    const top = LEG_GAUGE.bottom - clamp01(frac) * (LEG_GAUGE.bottom - LEG_GAUGE.top);
    el(rectId).setAttribute("y", S(top));
    el(rectId).setAttribute("height", S(LEG_GAUGE.bottom - top));
    el(lineId).setAttribute("y1", S(top));
    el(lineId).setAttribute("y2", S(top));
  };
  fill("chargeR", "chargeRl", base * (1 + skew));
  fill("chargeLf", "chargeLl", base * (1 - skew));

  for (const t of TAGS) {
    const v = valueOn(t.metric, day);
    const s = PLATE.metrics[t.metric];
    el(`tv-${t.id}`).textContent = fmt(t.metric, v);
    el(`tu-${t.id}`).textContent = s?.unit ?? "";
  }
}

/**
 * Daily health readings are jagged enough that a raw line reads as noise
 * and hides the only thing worth seeing, which is the direction of travel.
 * A short centred moving average keeps the shape and drops the jitter.
 */
function smooth(values, window = 7) {
  if (values.length < window) return values;
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(values.length, i + half + 1);
    const slice = values.slice(lo, hi);
    return slice.reduce((s, v) => s + v, 0) / slice.length;
  });
}

function sparkline(summary, upToDay) {
  const pts = summary.series.filter(p => p.qty != null);
  if (pts.length < 2) return { d: "", cx: 0, cy: 13 };
  const vals = smooth(pts.map(p => p.qty));
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const xy = vals.map((v, i) => [
    i / (vals.length - 1) * 120,
    26 - (v - lo) / span * 24 - 1
  ]);
  let idx = pts.findLastIndex(p => p.day <= upToDay);
  if (idx < 0) idx = pts.length - 1;
  return {
    d: xy.map((p, i) => (i ? "L" : "M") + S(p[0]) + " " + S(p[1])).join(" "),
    cx: xy[idx][0], cy: xy[idx][1]
  };
}

function renderTiles(day) {
  const readout = el("readout");
  readout.innerHTML = "";

  const shown = Object.values(PLATE.metrics)
    .filter(m => m.organ)
    .sort((a, b) => (a.organ === b.organ ? a.label.localeCompare(b.label)
                                         : a.organ.localeCompare(b.organ)));

  for (const m of shown) {
    const v = valueOn(m.name, day);
    const sp = sparkline(m, day);
    const b = document.createElement("button");
    b.className = "tile";
    b.type = "button";
    b.dataset.organ = m.organ;
    b.dataset.status = m.status;
    b.innerHTML =
      `<span class="tile-k"><i class="swatch"></i>${m.label}</span>` +
      `<span class="tile-v">${fmt(m.name, v)}<small>${m.unit}</small></span>` +
      `<svg class="spark" viewBox="0 0 120 26" preserveAspectRatio="none" aria-hidden="true">
         <path d="${sp.d}" fill="none" stroke="var(--carmine)" stroke-width="1.6"
               stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
         <circle cx="${S(sp.cx)}" cy="${S(sp.cy)}" r="2.6" fill="var(--carmine)"
                 stroke="var(--paper)" stroke-width="1.4"/>
       </svg>` +
      `<span class="tile-d">${m.note}</span>` +
      // Advice only where there is room to improve. Telling you how to fix
      // something already going well is how a page becomes wallpaper.
      (m.improve && (m.position ?? 1) < 0.55
        ? `<span class="tile-fix"><b>How to improve.</b> ${m.improve}</span>`
        : "");

    const on = () => focusOrgan(m.organ), off = () => focusOrgan(null);
    b.addEventListener("mouseenter", on); b.addEventListener("mouseleave", off);
    b.addEventListener("focus", on); b.addEventListener("blur", off);
    readout.appendChild(b);
  }
}

const organIds = ["brain", "lungs", "heart", "vasc", "legs"];
function focusOrgan(name) {
  const fig = el("figure");
  fig.classList.toggle("dim", !!name);
  for (const id of organIds) el(id)?.classList.toggle("on", id === name);
}

function renderNotes() {
  const list = el("noteList");
  const box = el("marginalia");
  if (!PLATE.notes.length) { box.hidden = true; return; }
  box.hidden = false;
  list.innerHTML = "";
  for (const n of PLATE.notes) {
    const li = document.createElement("li");
    li.dataset.status = n.status;
    li.innerHTML = `<b>${n.label}.</b> ${n.text}`;
    list.appendChild(li);
  }
}

function renderChrono(day) {
  const d = new Date(day + "T00:00:00");
  const isToday = cursor === DAYS.length - 1;
  el("elapsed").innerHTML =
    `${d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })} ` +
    `<em>${isToday ? "latest reading" : `${DAYS.length - 1 - cursor} days ago`}</em>`;
}

function render() {
  const day = DAYS[cursor];
  renderFigure(day);
  renderTiles(day);
  renderChrono(day);
}

/* ── boot ────────────────────────────────────────────────── */

function buildTicks() {
  const ticks = el("ticks");
  ticks.innerHTML = "";
  const n = Math.min(5, DAYS.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.round(i / (n - 1 || 1) * (DAYS.length - 1));
    const t = document.createElement("div");
    t.className = "tick";
    t.style.left = (DAYS.length > 1 ? idx / (DAYS.length - 1) * 100 : 0) + "%";
    const d = new Date(DAYS[idx] + "T00:00:00");
    t.innerHTML = `<i></i><b>${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}</b>`;
    ticks.appendChild(t);
  }
}

async function boot() {
  let data;
  try {
    const res = await fetch("/api/plate");
    if (!res.ok) throw new Error(`server returned ${res.status}`);
    data = await res.json();
  } catch (err) {
    el("dek").textContent =
      `Could not reach the local service — ${err.message}. Is it running?`;
    return;
  }

  PLATE = data;

  const days = new Set();
  for (const m of Object.values(PLATE.metrics)) {
    for (const p of m.series ?? []) days.add(p.day);
  }
  DAYS = [...days].sort();

  if (!DAYS.length) {
    el("dek").textContent =
      "No readings yet. Point Health Auto Export at this machine, or import a saved export.";
    return;
  }

  cursor = DAYS.length - 1;

  el("subject").textContent = "P. Mokida";
  el("dek").textContent =
    `${DAYS.length} recorded day${DAYS.length === 1 ? "" : "s"} across ` +
    `${Object.keys(PLATE.metrics).length} measures, held on this machine. ` +
    `Drag the chronometer to move through your own history.`;

  const last = PLATE.ingest?.last;
  el("freshness").textContent = last
    ? `Last sync ${new Date(last).toLocaleString(undefined, { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}`
    : "No sync yet";

  if (PLATE.coldStart) {
    const b = el("banner");
    b.hidden = false;
    b.innerHTML =
      `<b>Cold start.</b> Fewer than seven days on record, so values are being ` +
      `judged against broad population ranges. Once there is more history the ` +
      `plate switches to your own baseline, which is the only one worth acting on.`;
  }

  if (PLATE.smoking?.modelled) {
    const p = el("modelNote");
    p.hidden = false;
    p.innerHTML =
      `<b>Modelled, not measured.</b> Tar in the lungs is derived from your logged ` +
      `quit date on a nine-month cilia recovery curve. No sensor here sees a cigarette.`;
  }

  const scrub = el("scrub");
  scrub.max = String(DAYS.length - 1);
  scrub.value = String(cursor);
  scrub.addEventListener("input", () => { cursor = +scrub.value; render(); });

  el("today").addEventListener("click", () => {
    cursor = DAYS.length - 1;
    scrub.value = String(cursor);
    render();
  });

  el("theme").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme");
    const dark = cur ? cur === "dark"
                     : matchMedia("(prefers-color-scheme:dark)").matches;
    document.documentElement.setAttribute("data-theme", dark ? "light" : "dark");
  });

  el("hint").textContent = `${DAYS.length} days on record`;

  buildTicks();
  renderNotes();
  render();

  // Refresh while the page is open, so a sync lands without a reload.
  setInterval(async () => {
    try {
      const res = await fetch("/api/plate");
      if (!res.ok) return;
      const next = await res.json();
      const atToday = cursor === DAYS.length - 1;
      PLATE = next;
      const ds = new Set();
      for (const m of Object.values(PLATE.metrics)) for (const p of m.series ?? []) ds.add(p.day);
      DAYS = [...ds].sort();
      scrub.max = String(DAYS.length - 1);
      if (atToday) { cursor = DAYS.length - 1; scrub.value = String(cursor); }
      renderNotes();
      render();
    } catch { /* the service is down; keep showing the last good render */ }
  }, 60000);
}

boot();
