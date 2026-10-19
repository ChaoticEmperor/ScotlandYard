#!/usr/bin/env node
// Fits the original station layout onto central London so the ferry stations sit on the banks
// of the real River Thames, then nudges stations out of the water while keeping spacing and
// route crossings in check. Rewrites web/data/layout.json with the fitted positions, the
// board->geo transform and the river centreline in board pixels.
// River geometry: (c) OpenStreetMap contributors, ODbL (see web/tools/london/README.md).
// Usage: node web/tools/london/fit-layout.mjs thames.json   (run after build-layout.mjs)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { metrics, segCross, segPointDist } from "../layout-metrics.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "..", "data");
const g = JSON.parse(readFileSync(join(dataDir, "graph.json"), "utf8"));
const L = JSON.parse(readFileSync(join(dataDir, "layout.json"), "utf8"));
const T = JSON.parse(readFileSync(process.argv[2], "utf8"));
const N = g.stations, W = L.width, H = L.height;

let seed = 99;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

// Local metric projection around central London (y grows southwards like screen pixels).
const LON0 = -0.12, LAT0 = 51.51, KX = Math.cos((LAT0 * Math.PI) / 180) * 111320, KY = 110574;
const toM = ([lon, lat]) => [(lon - LON0) * KX, -(lat - LAT0) * KY];
const BB = { x0: toM([-0.245, 0])[0], x1: toM([0.005, 0])[0], y0: toM([0, 51.565])[1], y1: toM([0, 51.455])[1] };
const center = toM.bind(null);
const C = T.centerline.map(center);

// Board pixel -> metres for parameters q = {s, th, f, ox, oy}.
function fwd(q, x, y) {
  const dx = x - W / 2, dy = (y - H / 2) * q.f, c = Math.cos(q.th), s = Math.sin(q.th);
  return [q.ox + q.s * (c * dx - s * dy), q.oy + q.s * (s * dx + c * dy)];
}
function inv(q, mx, my) {
  const c = Math.cos(q.th), s = Math.sin(q.th), ux = (mx - q.ox) / q.s, uy = (my - q.oy) / q.s;
  return [W / 2 + c * ux + s * uy, H / 2 + (-s * ux + c * uy) * q.f];
}

// Distance from a metric point to the centreline, plus arc-length position of the nearest point.
const cumLen = [0];
for (let i = 1; i < C.length; i++) cumLen.push(cumLen[i - 1] + Math.hypot(C[i][0] - C[i - 1][0], C[i][1] - C[i - 1][1]));
function nearest(p) {
  let bd = Infinity, at = 0;
  for (let i = 0; i < C.length - 1; i++) {
    const a = C[i], b = C[i + 1], vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l2));
    const d = Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy);
    if (d < bd) (bd = d), (at = cumLen[i] + t * Math.sqrt(l2));
  }
  return [bd, at];
}

const pos = [null];
for (let i = 1; i <= N; i++) pos.push(L.positions[i].slice());
const chain = ferryChain();
const piers = new Set(chain);

// Stage 1: global search over scale, rotation, flip and offset.
function score1(q) {
  let cost = 0, last = null, dir = 0;
  for (const s of chain) {
    const [d, at] = nearest(fwd(q, ...pos[s]));
    cost += (d / q.s) ** 2;
    if (last !== null) {
      const sg = Math.sign(at - last);
      if (dir && sg !== dir) cost += 1e5;
      dir = sg;
      if (Math.abs(at - last) < 120 * q.s) cost += 2e3; // keep piers spread along the river
    }
    last = at;
  }
  for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H]]) {
    const [mx, my] = fwd(q, x, y);
    if (mx < BB.x0 || mx > BB.x1 || my < BB.y0 || my > BB.y1) cost += 1e4;
  }
  return cost;
}
let cands = [];
for (let k = 0; k < 60000; k++) {
  const q = { s: 5.6 + rand() * 2.4, th: rand() * Math.PI * 2, f: rand() < 0.5 ? 1 : -1, ox: -3500 + rand() * 7000, oy: -3000 + rand() * 5000 };
  cands.push([score1(q), q]);
}
cands.sort((a, b) => a[0] - b[0]);
cands = cands.slice(0, 40).map(([, q]) => refine(q, score1, 1500));

// Stage 2: prefer few river crossings and no stations sitting in the river.
const E = [];
for (const [t, list] of Object.entries(g.edges)) for (const [a, b] of list) E.push([a, b, t]);
function score2(q) {
  let cost = score1(q);
  const Cb = C.map(([mx, my]) => inv(q, mx, my));
  for (let i = 1; i <= N; i++) {
    if (piers.has(i)) continue;
    const d = nearest(fwd(q, ...pos[i]))[0] / q.s;
    if (d < 40) cost += 6 * (40 - d) ** 2 / 40;
  }
  for (const [a, b, t] of E) {
    if (t === "underground" || t === "ferry") continue;
    for (let j = 0; j < Cb.length - 1; j++) if (segCross(pos[a], pos[b], Cb[j], Cb[j + 1])) cost += 25;
  }
  return cost;
}
const fitted = cands.map((q) => refine(q, score2, 400)).map((q) => [score2(q), q]).sort((a, b) => a[0] - b[0]);
const Q = fitted[0][1];
console.log(`fit: ${Q.s.toFixed(2)} m/px, rotation ${((Q.th * 180) / Math.PI).toFixed(1)} deg, ${Q.f < 0 ? "mirrored" : "unmirrored"}, score ${fitted[0][0].toFixed(0)}`);

function refine(q, f, iters) {
  let best = { ...q }, bv = f(best);
  for (let k = 0; k < iters; k++) {
    const sc = 1 - k / iters;
    const c = { ...best, s: best.s * (1 + gauss() * 0.02 * sc), th: best.th + gauss() * 0.05 * sc, ox: best.ox + gauss() * 150 * sc, oy: best.oy + gauss() * 150 * sc };
    const v = f(c);
    if (v < bv) (bv = v), (best = c);
  }
  return best;
}

// Re-express the layout in a north-up frame: the layout is rotated/mirrored to suit the real map,
// never the other way round, so London is drawn the right way up.
const PAD = 70;
const S = Q.s;
const M = pos.map((p) => (p ? fwd(Q, p[0], p[1]) : null));
let mx0 = Infinity, my0 = Infinity, mx1 = -Infinity, my1 = -Infinity;
for (let i = 1; i <= N; i++) (mx0 = Math.min(mx0, M[i][0])), (my0 = Math.min(my0, M[i][1])), (mx1 = Math.max(mx1, M[i][0])), (my1 = Math.max(my1, M[i][1]));
mx0 -= PAD * S; my0 -= PAD * S; mx1 += PAD * S; my1 += PAD * S;
const BW = Math.round((mx1 - mx0) / S), BH = Math.round((my1 - my0) / S);
const toPx = ([mx, my]) => [(mx - mx0) / S, (my - my0) / S];
for (let i = 1; i <= N; i++) pos[i] = toPx(M[i]);
if (mx0 < BB.x0 || mx1 > BB.x1 || my0 < BB.y0 || my1 > BB.y1) console.warn("warning: board extends past the OSM extract bbox");

// River in board pixels: centreline and a signed-distance raster from the water polygons.
const riverLine = C.map(toPx);
const polys = [];
for (const w of T.water) for (const ring of [w.p, ...(w.h || [])]) polys.push(ring.map((p) => toPx(toM(p))));
const CELL = 3, gw = Math.ceil(BW / CELL) + 1, gh = Math.ceil(BH / CELL) + 1;
const inside = new Uint8Array(gw * gh), dist = new Float32Array(gw * gh).fill(60);
for (let j = 0; j < gh; j++) {
  const y = j * CELL, xs = [];
  for (const r of polys)
    for (let k = 0; k < r.length - 1; k++) {
      const a = r[k], b = r[k + 1];
      if ((a[1] <= y) !== (b[1] <= y)) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
  xs.sort((a, b) => a - b);
  for (let m = 0; m + 1 < xs.length; m += 2)
    for (let i = Math.max(0, Math.ceil(xs[m] / CELL)); i <= Math.min(gw - 1, Math.floor(xs[m + 1] / CELL)); i++) inside[j * gw + i] = 1;
}
for (const r of polys)
  for (let k = 0; k < r.length - 1; k++) {
    const a = r[k], b = r[k + 1], R = 60;
    if (Math.max(a[0], b[0]) < -R || Math.min(a[0], b[0]) > BW + R || Math.max(a[1], b[1]) < -R || Math.min(a[1], b[1]) > BH + R) continue;
    const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - R) / CELL)), i1 = Math.min(gw - 1, Math.ceil((Math.max(a[0], b[0]) + R) / CELL));
    const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - R) / CELL)), j1 = Math.min(gh - 1, Math.ceil((Math.max(a[1], b[1]) + R) / CELL));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const d = segPointDist([i * CELL, j * CELL], a, b);
        if (d < dist[j * gw + i]) dist[j * gw + i] = d;
      }
  }
const sd = (x, y) => {
  const i = Math.round(x / CELL), j = Math.round(y / CELL);
  if (i < 0 || j < 0 || i >= gw || j >= gh) return 60;
  const k = j * gw + i;
  return inside[k] ? -dist[k] : dist[k];
};
const crossesRiver = (p, q) => {
  for (let j = 0; j < riverLine.length - 1; j++) if (segCross(p, q, riverLine[j], riverLine[j + 1])) return true;
  return false;
};

// Stage 3: local warp.
const P = pos.slice(1);
const EI = E.map(([a, b, t]) => [a - 1, b - 1, t]);
const inc = P.map(() => []);
EI.forEach((e, k) => (inc[e[0]].push(k), inc[e[1]].push(k)));
const MIN_SEP = 44, HOP = 64;
function stationWater(i, p) {
  const d = sd(p[0], p[1]);
  if (piers.has(i + 1)) return 3 * ((d - 5) / 5) ** 2;
  return d < 20 ? 40 * ((20 - d) / 20) ** 2 + (d < 0 ? 80 : 0) : 0;
}
function localCost(i, p) {
  const old = P[i];
  P[i] = p;
  let c = stationWater(i, p);
  for (let j = 0; j < N; j++) {
    if (j === i) continue;
    const d = Math.hypot(P[j][0] - p[0], P[j][1] - p[1]);
    if (d < MIN_SEP) c += 400 * ((MIN_SEP - d) / MIN_SEP) ** 2 + (d < 34 ? 200 : 0);
  }
  for (const k of inc[i]) {
    const [a, b, t] = EI[k];
    if (t === "taxi" || t === "bus") {
      if (crossesRiver(P[a], P[b])) c += t === "taxi" ? 3 : 1.5;
      else for (let s = 1; s < 5; s++) if (sd(P[a][0] + ((P[b][0] - P[a][0]) * s) / 5, P[a][1] + ((P[b][1] - P[a][1]) * s) / 5) < 0) { c += 6; break; }
    }
    for (let m = 0; m < EI.length; m++) {
      if (m === k) continue;
      const [c1, c2, u] = EI[m];
      if (c1 === a || c1 === b || c2 === a || c2 === b) continue;
      if (inc[i].includes(m) && m < k) continue;
      if (t === "taxi" && u === "taxi" && segCross(P[a], P[b], P[c1], P[c2])) c += 12;
    }
    if (t === "taxi") {
      for (let j = 0; j < N; j++) if (j !== a && j !== b && segPointDist(P[j], P[a], P[b]) < 20) c += 20 * (1 - segPointDist(P[j], P[a], P[b]) / 20);
      const len = Math.hypot(P[a][0] - P[b][0], P[a][1] - P[b][1]);
      c += 0.6 * ((len - HOP) / HOP) ** 2;
    }
  }
  for (let m = 0; m < EI.length; m++) {
    const [a, b, t] = EI[m];
    if (a === i || b === i || t !== "taxi") continue;
    const d = segPointDist(p, P[a], P[b]);
    if (d < 20) c += 20 * (1 - d / 20);
  }
  if (p[0] < 40 || p[1] < 40 || p[0] > BW - 40 || p[1] > BH - 40) c += 50;
  P[i] = old;
  return c;
}
const PASSES = 70;
for (let pass = 0; pass < PASSES; pass++) {
  const sigma = 40 * (1 - pass / PASSES) + 4;
  for (const i of [...Array(N).keys()].sort(() => rand() - 0.5)) {
    let best = localCost(i, P[i]), bestP = P[i];
    const cands = [];
    for (let k = 0; k < 6; k++) cands.push([P[i][0] + gauss() * sigma, P[i][1] + gauss() * sigma]);
    for (const c of cands) {
      const v = localCost(i, c);
      if (v < best - 1e-9) (best = v), (bestP = c);
    }
    P[i] = bestP;
  }
  if (pass % 10 === 9) report(`pass ${pass + 1}`);
}

function report(tag) {
  const m = metrics(P, EI);
  let wet = 0, pierOff = 0, bridges = 0;
  for (let i = 0; i < N; i++) {
    const d = sd(...P[i]);
    if (piers.has(i + 1)) pierOff = Math.max(pierOff, Math.abs(d - 5));
    else if (d < 14) wet++;
  }
  for (const [a, b, t] of EI) if ((t === "taxi" || t === "bus") && crossesRiver(P[a], P[b])) bridges++;
  console.log(`${tag}: taxi crossings ${m.taxiCrossings}, min sep ${m.minSep}px, grazes ${m.grazes}, stations near water ${wet}, worst pier offset ${pierOff.toFixed(1)}px, road bridges ${bridges}`);
  return { ...m, wet, pierOff, bridges };
}
const final = report("final");

// River centreline clipped to the board (plus margin) and its typical width.
const clip = riverLine.filter(([x, y]) => x > -200 && y > -200 && x < BW + 200 && y < BH + 200);
let widths = [];
for (let k = 0; k < clip.length; k += 2) {
  const d = -sd(clip[k][0], clip[k][1]);
  if (d > 0 && d < 60) widths.push(2 * d);
}
widths.sort((a, b) => a - b);
const riverWidth = Math.round(widths[widths.length >> 1] || 30);

const out = { ...L, width: BW, height: BH };
out.method += "; fitted onto central London so ferry stations sit on the Thames (tools/london/fit-layout.mjs)";
out.positions = {};
P.forEach(([x, y], i) => (out.positions[i + 1] = [Math.round(x), Math.round(y)]));
out.metrics = { minSep: final.minSep, taxiCrossings: final.taxiCrossings, bridges: final.bridges, allCrossings: final.allCrossings, grazes: final.grazes };
// px = ((lon - lon0) * kx - mx0) / metresPerPx,  py = (-(lat - lat0) * ky - my0) / metresPerPx  (north up)
out.geo = { lon0: LON0, lat0: LAT0, kx: KX, ky: KY, metresPerPx: S, mx0, my0, attribution: "© OpenStreetMap contributors" };
out.river = { width: riverWidth, line: clip.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]) };
writeFileSync(join(dataDir, "layout.json"), JSON.stringify(out, null, 1).replace(/\[\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]/g, "[$1,$2]") + "\n");
console.log(`wrote layout.json ${BW}x${BH} (river width ${riverWidth}px)`);

function ferryChain() {
  const nb = {};
  for (const [a, b] of g.edges.ferry) ((nb[a] = nb[a] || []).push(b), (nb[b] = nb[b] || []).push(a));
  const ends = Object.keys(nb).filter((k) => nb[k].length === 1).map(Number);
  const out = [Math.max(...ends)];
  while (true) {
    const nx = nb[out[out.length - 1]].find((s) => !out.includes(s));
    if (nx === undefined) return out;
    out.push(nx);
  }
}
