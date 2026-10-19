#!/usr/bin/env node
// Generates original station positions for web/data/graph.json into web/data/layout.json.
// Positions come only from graph structure (stress majorization on shortest-path distances),
// then a local search spaces stations out and reduces route crossings. No board coordinates are used.
// Usage: node web/tools/build-layout.mjs [--seed N]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { metrics, segCross, segPointDist } from "./layout-metrics.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const g = JSON.parse(readFileSync(join(here, "..", "data", "graph.json"), "utf8"));
const seedArg = process.argv.indexOf("--seed");
let seed = seedArg > 0 ? Number(process.argv[seedArg + 1]) : 7;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

const N = g.stations;
const HOP = 64; // target length of a taxi hop, in px at default zoom
const MIN_SEP = 46; // spacing goal; the hard requirement is 34
const ids = Array.from({ length: N }, (_, i) => i + 1);

// Weighted shortest paths: long-distance transport counts as several taxi hops.
const W = { taxi: 1, bus: 2.2, underground: 3.6, ferry: 2.4 };
const nbr = ids.map(() => []);
for (const [t, list] of Object.entries(g.edges)) for (const [a, b] of list) nbr[a - 1].push([b - 1, W[t]]), nbr[b - 1].push([a - 1, W[t]]);
const D = ids.map((_, s) => {
  const d = new Float64Array(N).fill(Infinity);
  d[s] = 0;
  const done = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    let u = -1;
    for (let i = 0; i < N; i++) if (!done[i] && (u < 0 || d[i] < d[u])) u = i;
    done[u] = 1;
    for (const [v, w] of nbr[u]) if (d[u] + w < d[v]) d[v] = d[u] + w;
  }
  return d;
});

// Classical MDS start (top two eigenvectors of the double-centred squared distances).
function mds() {
  const B = ids.map(() => new Float64Array(N));
  const row = new Float64Array(N);
  let all = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) (row[i] += D[i][j] ** 2), (all += D[i][j] ** 2);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) B[i][j] = -0.5 * (D[i][j] ** 2 - row[i] / N - row[j] / N + all / N / N);
  const vecs = [];
  for (let k = 0; k < 2; k++) {
    let v = Float64Array.from(ids, () => rand() - 0.5);
    let lambda = 0;
    for (let it = 0; it < 300; it++) {
      const w = new Float64Array(N);
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) w[i] += B[i][j] * v[j];
      for (const [u, l] of vecs) {
        let dot = 0;
        for (let i = 0; i < N; i++) dot += w[i] * u[i];
        for (let i = 0; i < N; i++) w[i] -= dot * u[i];
      }
      lambda = Math.hypot(...w);
      v = w.map((x) => x / lambda);
    }
    vecs.push([v, lambda]);
  }
  return ids.map((_, i) => [vecs[0][0][i] * Math.sqrt(vecs[0][1]), vecs[1][0][i] * Math.sqrt(vecs[1][1])]);
}

// Stress majorization (SMACOF) with weights 1/d^2.
function smacof(P, iters) {
  for (let it = 0; it < iters; it++) {
    const Q = P.map(() => [0, 0]);
    for (let i = 0; i < N; i++) {
      let ws = 0;
      for (let j = 0; j < N; j++) {
        if (i === j) continue;
        const dij = D[i][j] * HOP;
        const w = 1 / (dij * dij);
        const dx = P[i][0] - P[j][0], dy = P[i][1] - P[j][1];
        const cur = Math.hypot(dx, dy) || 1e-6;
        Q[i][0] += w * (P[j][0] + (dij * dx) / cur);
        Q[i][1] += w * (P[j][1] + (dij * dy) / cur);
        ws += w;
      }
      Q[i][0] /= ws;
      Q[i][1] /= ws;
    }
    P = Q;
  }
  return P;
}

let P = mds().map(([x, y]) => [x * HOP, y * HOP]);
P = smacof(P, 400);

// Landscape orientation: rotate so the widest spread is horizontal.
{
  let cx = 0, cy = 0;
  P.forEach(([x, y]) => ((cx += x / N), (cy += y / N)));
  let sxx = 0, syy = 0, sxy = 0;
  P.forEach(([x, y]) => ((sxx += (x - cx) ** 2), (syy += (y - cy) ** 2), (sxy += (x - cx) * (y - cy))));
  const a = -0.5 * Math.atan2(2 * sxy, sxx - syy);
  P = P.map(([x, y]) => [(x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)]);
}

// Edge list for the local search. Taxi crossings matter most; long routes are drawn as curves.
const E = [];
for (const [t, list] of Object.entries(g.edges)) for (const [a, b] of list) E.push([a - 1, b - 1, t]);
const inc = ids.map(() => []);
E.forEach((e, k) => (inc[e[0]].push(k), inc[e[1]].push(k)));
// Ferry links become the river in the map art, so a taxi crossing one is a bridge: allowed, but kept rare.
const pairW = (s, t) => {
  if (s === "taxi" && t === "taxi") return 1;
  if (s === "ferry" || t === "ferry") return s === "taxi" || t === "taxi" ? 0.3 : 0.05;
  return s === "taxi" || t === "taxi" ? 0.12 : 0.04;
};

// Local cost of station i at position p: crossings of its edges, spacing, edges grazing stations, hop length.
function localCost(i, p) {
  const old = P[i];
  P[i] = p;
  let c = 0;
  for (let j = 0; j < N; j++) {
    if (j === i) continue;
    const d = Math.hypot(P[j][0] - p[0], P[j][1] - p[1]);
    if (d < MIN_SEP) c += 40 * ((MIN_SEP - d) / MIN_SEP) ** 2 * 10 + (d < 34 ? 50 : 0);
  }
  for (const k of inc[i]) {
    const [a, b, t] = E[k];
    for (let m = 0; m < E.length; m++) {
      if (m === k) continue;
      const [c1, c2, u] = E[m];
      if (c1 === a || c1 === b || c2 === a || c2 === b) continue;
      if (inc[i].includes(m) && m < k) continue; // count each pair once
      if (segCross(P[a], P[b], P[c1], P[c2])) c += 6 * pairW(t, u);
    }
    if (t === "taxi" || t === "ferry") {
      for (let j = 0; j < N; j++) {
        if (j === a || j === b) continue;
        const d = segPointDist(P[j], P[a], P[b]);
        if (d < 20) c += 4 * (1 - d / 20);
      }
      const len = Math.hypot(P[a][0] - P[b][0], P[a][1] - P[b][1]);
      c += 0.6 * ((len - HOP) / HOP) ** 2;
    }
  }
  // This station grazing other taxi edges.
  for (let m = 0; m < E.length; m++) {
    const [a, b, t] = E[m];
    if (a === i || b === i || (t !== "taxi" && t !== "ferry")) continue;
    const d = segPointDist(p, P[a], P[b]);
    if (d < 20) c += 4 * (1 - d / 20);
  }
  P[i] = old;
  return c;
}

const PASSES = 90;
for (let pass = 0; pass < PASSES; pass++) {
  const sigma = 36 * (1 - pass / PASSES) + 4;
  for (const i of ids.map((x) => x - 1).sort(() => rand() - 0.5)) {
    let best = localCost(i, P[i]);
    let bestP = P[i];
    const cands = [];
    for (let k = 0; k < 5; k++) cands.push([P[i][0] + gauss() * sigma, P[i][1] + gauss() * sigma]);
    // Untangle: reflect across the line of any taxi edge that one of this station's taxi edges crosses.
    for (const k of inc[i]) {
      const [a, b, t] = E[k];
      if (t !== "taxi") continue;
      for (const [c1, c2, u] of E) {
        if (u !== "taxi" || [c1, c2].some((x) => x === a || x === b) || !segCross(P[a], P[b], P[c1], P[c2])) continue;
        const [x1, y1] = P[c1], vx = P[c2][0] - x1, vy = P[c2][1] - y1;
        const s = ((P[i][0] - x1) * vx + (P[i][1] - y1) * vy) / (vx * vx + vy * vy);
        const fx = x1 + s * vx, fy = y1 + s * vy;
        cands.push([2 * fx - P[i][0], 2 * fy - P[i][1]], [fx + (fx - P[i][0]) * 0.4, fy + (fy - P[i][1]) * 0.4]);
      }
    }
    const tn = nbr[i].filter(([, w]) => w === 1).map(([v]) => P[v]);
    if (tn.length) cands.push([tn.reduce((s, q) => s + q[0], 0) / tn.length, tn.reduce((s, q) => s + q[1], 0) / tn.length]);
    for (const c of cands) {
      const v = localCost(i, c);
      if (v < best - 1e-9) (best = v), (bestP = c);
    }
    P[i] = bestP;
  }
  if (pass % 15 === 14) {
    const m = metrics(P, E);
    console.log(`pass ${pass + 1}: taxi crossings ${m.taxiCrossings}, bridges ${m.bridges}, min sep ${m.minSep.toFixed(1)}px, grazes ${m.grazes}`);
  }
}

// Normalise into a padded canvas.
const PAD = 70;
const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
const minX = Math.min(...xs), minY = Math.min(...ys);
const out = {};
P.forEach(([x, y], i) => (out[i + 1] = [Math.round(x - minX + PAD), Math.round(y - minY + PAD)]));
const width = Math.round(Math.max(...xs) - minX + 2 * PAD);
const height = Math.round(Math.max(...ys) - minY + 2 * PAD);
const final = metrics(ids.map((i) => out[i]), E);
const layout = {
  name: "Fog Yard original station layout",
  method: "Stress majorization on weighted shortest paths of graph.json, then local search for spacing and fewer crossings",
  width,
  height,
  metrics: final,
  positions: out,
};
writeFileSync(join(here, "..", "data", "layout.json"), JSON.stringify(layout, null, 1).replace(/\[\s+(-?\d+),\s+(-?\d+)\s+\]/g, "[$1,$2]") + "\n");
console.log(`wrote layout ${width}x${height}`, final);
