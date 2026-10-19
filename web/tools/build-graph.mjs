#!/usr/bin/env node
// Builds web/data/graph.json from the repo's GameInitializer/resources/stations.json.
// Only station numbers and adjacency are read; the repo's board coordinates are ignored.
// Usage: node web/tools/build-graph.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const src = JSON.parse(readFileSync(join(root, "GameInitializer/resources/stations.json"), "utf8"));

const KEYS = { neighbourTaxis: "taxi", neighbourBuses: "bus", neighbourUndergrounds: "underground" };

// Corrections to the repo data, each checked against the current board (see web/NOTES.md).
const PATCHES = {
  add: [
    ["taxi", 58, 75], // missing in both directions in the repo
    ["ferry", 108, 115], // the repo has no ferries
    ["ferry", 115, 157],
    ["ferry", 157, 194],
  ],
  remove: [
    ["taxi", 13, 14], // removed on later boards; 13-14 remains a bus link
  ],
};

// Start-card pools from the repo's GameInitializer (Ravensburger has 29 start cards).
const STARTS = {
  detective: [13, 26, 29, 34, 50, 53, 91, 94, 103, 112, 117, 123, 138, 141, 155, 174],
  mrx: [35, 45, 51, 71, 78, 104, 106, 127, 132, 146, 166, 170, 172],
};

const edges = { taxi: new Set(), bus: new Set(), underground: new Set(), ferry: new Set() };
const key = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
const log = [];

for (const st of src) {
  if (st.number === 0) continue; // placeholder entry
  for (const [k, t] of Object.entries(KEYS)) {
    for (const n of st[k]) {
      const back = src.find((s) => s.number === n)[k].includes(st.number);
      if (!back) log.push(`symmetrised ${t} ${st.number}-${n} (was one-way)`);
      edges[t].add(key(st.number, n));
    }
  }
}
for (const [t, a, b] of PATCHES.remove) {
  if (edges[t].delete(key(a, b))) log.push(`removed ${t} ${a}-${b}`);
}
for (const [t, a, b] of PATCHES.add) {
  if (!edges[t].has(key(a, b))) log.push(`added ${t} ${a}-${b}`);
  edges[t].add(key(a, b));
}

const toPairs = (set) =>
  [...set].map((s) => s.split("-").map(Number)).sort((p, q) => p[0] - q[0] || p[1] - q[1]);

const out = {
  name: "Fog Yard station network",
  source: "Derived from tim-koehler/ScotlandYard (Apache-2.0), GameInitializer/resources/stations.json, with corrections listed in web/NOTES.md",
  stations: 199,
  starts: STARTS,
  edges: Object.fromEntries(Object.entries(edges).map(([t, s]) => [t, toPairs(s)])),
};

mkdirSync(join(here, "..", "data"), { recursive: true });
const json = JSON.stringify(out, null, 1).replace(/\[[\d,\s]+\]/g, (m) => m.replace(/\s+/g, ""));
writeFileSync(join(here, "..", "data", "graph.json"), json + "\n");
log.forEach((l) => console.log(l));
console.log(Object.entries(out.edges).map(([t, e]) => `${t}: ${e.length}`).join(", "));
