#!/usr/bin/env node
// Validates web/data/layout.json against graph.json: every station placed inside the canvas,
// stations at least 34px apart at default zoom, and the recorded metrics still hold.
// Usage: node web/tools/validate-layout.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { metrics } from "./layout-metrics.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const g = JSON.parse(readFileSync(join(here, "..", "data", "graph.json"), "utf8"));
const L = JSON.parse(readFileSync(join(here, "..", "data", "layout.json"), "utf8"));
const errors = [];
const P = [];
for (let i = 1; i <= g.stations; i++) {
  const p = L.positions[i];
  if (!p) errors.push(`station ${i} has no position`);
  else if (!(p[0] >= 0 && p[0] <= L.width && p[1] >= 0 && p[1] <= L.height)) errors.push(`station ${i} outside canvas`);
  P.push(p || [0, 0]);
}
if (Object.keys(L.positions).length !== g.stations) errors.push("layout has extra stations");
const E = [];
for (const [t, list] of Object.entries(g.edges)) for (const [a, b] of list) E.push([a - 1, b - 1, t]);
const m = metrics(P, E);
if (m.minSep < 34) errors.push(`stations only ${m.minSep}px apart (need 34)`);
if (m.grazes) errors.push(`${m.grazes} taxi routes pass within 14px of an unrelated station`);
if (m.taxiCrossings > (L.metrics?.taxiCrossings ?? 0)) errors.push(`taxi crossings rose to ${m.taxiCrossings}`);
if (errors.length) {
  errors.forEach((e) => console.error("FAIL " + e));
  process.exit(1);
}
console.log(`OK layout ${L.width}x${L.height}: min separation ${m.minSep}px, taxi crossings ${m.taxiCrossings}, road bridges ${L.metrics?.bridges ?? m.bridges}`);
