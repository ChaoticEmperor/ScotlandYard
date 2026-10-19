#!/usr/bin/env node
// Validates web/data/graph.json: stations 1..N, no self loops or duplicates, symmetric
// adjacency, no dead stations, connected, and sane start pools. Exits 1 on failure.
// Usage: node web/tools/validate-graph.mjs [path/to/graph.json]
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] || join(here, "..", "data", "graph.json");
const g = JSON.parse(readFileSync(file, "utf8"));
const N = g.stations;
const errors = [];
const fail = (m) => errors.push(m);

const adj = {};
for (let i = 1; i <= N; i++) adj[i] = { taxi: [], bus: [], underground: [], ferry: [] };

for (const [t, list] of Object.entries(g.edges)) {
  if (!adj[1][t]) fail(`unknown transport ${t}`);
  const seen = new Set();
  for (const [a, b] of list) {
    if (!(a >= 1 && a <= N && b >= 1 && b <= N)) fail(`${t} ${a}-${b} out of range`);
    else if (a === b) fail(`${t} self loop at ${a}`);
    else {
      const k = Math.min(a, b) + "-" + Math.max(a, b);
      if (seen.has(k)) fail(`${t} duplicate ${k}`);
      seen.add(k);
      adj[a][t].push(b);
      adj[b][t].push(a);
    }
  }
}

// Symmetry of the derived adjacency (guards against future hand edits of the loader).
for (let a = 1; a <= N; a++)
  for (const t in adj[a]) for (const b of adj[a][t]) if (!adj[b][t].includes(a)) fail(`${t} ${a}->${b} not symmetric`);

// Dead stations: every station needs at least one taxi link, since detectives can only use taxi everywhere.
for (let a = 1; a <= N; a++) if (!adj[a].taxi.length) fail(`station ${a} has no taxi link`);

// Connectivity, over detective-usable transport only (no ferry), so the board is fully playable.
const seen = new Set([1]);
const stack = [1];
while (stack.length) {
  const a = stack.pop();
  for (const t of ["taxi", "bus", "underground"]) for (const b of adj[a][t]) if (!seen.has(b)) (seen.add(b), stack.push(b));
}
if (seen.size !== N) fail(`not connected: ${N - seen.size} unreachable`);

// Underground stations must also be bus stops, matching the board's station types.
for (let a = 1; a <= N; a++) if (adj[a].underground.length && !adj[a].bus.length) fail(`underground station ${a} has no bus`);

const { detective = [], mrx = [] } = g.starts || {};
if (detective.length < 6) fail("need at least 6 detective start positions");
if (new Set([...detective, ...mrx]).size !== detective.length + mrx.length) fail("start pools overlap or repeat");

if (errors.length) {
  errors.forEach((e) => console.error("FAIL " + e));
  process.exit(1);
}
const count = (t) => g.edges[t].length;
console.log(`OK ${N} stations; taxi ${count("taxi")}, bus ${count("bus")}, underground ${count("underground")}, ferry ${count("ferry")}`);
