/**
 * Vasculature — the map, drawn over the same figure as the plate so the
 * journey reads as happening inside the body you were just looking at.
 */

import { TORSO, LEG, ARM, MIRROR } from "./anatomy.js";

const NS = "http://www.w3.org/2000/svg";
const el = id => document.getElementById(id);
const mk = (tag, attrs, text) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  return e;
};

/* faint body behind the map */
const body = el("body");
for (const [d, transform] of [[TORSO, null], [LEG, null], [LEG, MIRROR], [ARM, null], [ARM, MIRROR]]) {
  const p = mk("path", { d, fill: "var(--flesh)", stroke: "var(--ink)", "stroke-width": 1 });
  if (transform) p.setAttribute("transform", transform);
  body.appendChild(p);
}

let STATE = null;

function render(state) {
  STATE = state;
  const { nodes, edges, visited, position, routes } = state;
  const seen = new Set(visited);
  const reachable = new Set(routes.filter(r => r.reachable).map(r => r.to));
  const adjacent = new Set(routes.map(r => r.to));

  /* edges */
  const eg = el("edges");
  eg.innerHTML = "";
  for (const [a, b] of edges) {
    const [x1, y1] = nodes[a].at, [x2, y2] = nodes[b].at;
    const walked = seen.has(a) && seen.has(b);
    const here = (a === position && adjacent.has(b)) || (b === position && adjacent.has(a));
    eg.appendChild(mk("line", {
      x1, y1, x2, y2,
      class: "vessel" + (walked ? " walked" : here ? " here" : "")
    }));
  }

  /* nodes */
  const ng = el("nodes");
  ng.innerHTML = "";
  for (const [id, n] of Object.entries(nodes)) {
    const isHere = id === position;
    const cls = ["node"];
    if (seen.has(id)) cls.push("seen");
    if (isHere) cls.push("here");
    if (reachable.has(id)) cls.push("reachable");
    if (n.gate && !seen.has(id)) cls.push("locked");

    const g = mk("g", { class: cls.join(" ") });
    if (isHere) g.appendChild(mk("circle", { cx: n.at[0], cy: n.at[1], r: 7, class: "here-ping" }));
    g.appendChild(mk("circle", { cx: n.at[0], cy: n.at[1], r: isHere ? 9 : 6 }));

    // The thorax is crowded, so nodes may override which side their label
    // sits on and nudge it vertically. Everything else falls back to
    // "away from the midline", which is right for the limbs.
    const side = n.side ?? (n.at[0] < 280 ? "end" : "start");
    g.appendChild(mk("text", {
      x: n.at[0] + (side === "end" ? -12 : 12),
      y: n.at[1] + 3.5 + (n.dy ?? 0),
      "text-anchor": side
    }, n.short ?? n.label));
    ng.appendChild(g);
  }

  /* panel */
  el("available").textContent = state.available.toLocaleString();
  el("bankSub").textContent =
    `${state.banked.toLocaleString()} walked since starting, ${state.spent.toLocaleString()} spent travelling.`;

  const tarLine = el("tarLine");
  if (state.tar > 0) {
    tarLine.hidden = false;
    tarLine.textContent =
      `${state.tar.toLocaleString()} held back as tar, from ${state.cigarettes} cigarette${state.cigarettes === 1 ? "" : "s"}.`;
  } else {
    tarLine.hidden = true;
  }

  el("hereName").textContent = `${state.positionLabel} — ${state.positionEn}`;
  el("hereNote").textContent = nodes[position].note ?? "";
  el("since").textContent = state.startedDay;
  el("progress").textContent = `${visited.length} of ${state.total} reached`;

  const list = el("routes");
  list.innerHTML = "";
  for (const r of routes) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "route " + (r.reachable ? "can" : "blocked");
    b.disabled = !r.reachable;

    const pct = Math.min(100, (1 - r.shortBy / r.cost) * 100);
    let note;
    if (r.visited && r.reachable) note = "Already reached. You can go back through it.";
    else if (r.gate && !r.gate.open) {
      const g = r.gate;
      note = `Closed — needs ${g.label} ${g.gate.op} ${g.gate.value}${g.unit ? " " + g.unit : ""}` +
             (g.current != null ? `, currently ${g.current.toFixed(1)}` : ", no reading yet") + ".";
    }
    else if (r.shortBy > 0) note = `${r.shortBy.toLocaleString()} more steps.`;
    else note = "Open. Walk it.";

    b.innerHTML =
      `<span class="rt-top"><span class="rt-name">${r.label}</span>` +
      `<span class="rt-cost">${r.cost.toLocaleString()} steps</span></span>` +
      `<span class="bar"><i style="width:${pct}%"></i></span>` +
      `<span class="rt-note">${note}</span>` +
      (r.reachable ? `<span><span class="go">Travel</span></span>` : "");

    if (r.reachable) b.addEventListener("click", () => go(r.to));
    list.appendChild(b);
  }
}

function say(text, kind = "") {
  const l = el("log");
  l.textContent = text;
  l.className = "log " + kind;
}

async function go(to) {
  const res = await fetch("/api/game/travel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to })
  });
  const data = await res.json();
  if (data.ok) {
    say(`Arrived at ${data.label}.`, "win");
    render(data.state);
  } else {
    say(data.error, "err");
  }
}

async function logEvent(kind, message) {
  await fetch("/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind })
  });
  say(message, kind === "cigarette" ? "err" : "win");
  load();
}

el("logCig").addEventListener("click", () =>
  logEvent("cigarette", "Tar laid down in this vessel. It will cost steps to clear."));
el("logCrav").addEventListener("click", () =>
  logEvent("craving", "Rode it out. Nothing laid down."));

async function load() {
  try {
    const res = await fetch("/api/game");
    if (!res.ok) throw new Error(`server returned ${res.status}`);
    render(await res.json());
  } catch (err) {
    say(`Could not reach the service — ${err.message}`, "err");
  }
}

load();
setInterval(load, 60000);
