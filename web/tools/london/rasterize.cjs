#!/usr/bin/env node
// Renders projected.json (project_osm.py) with render.html in headless Chromium and writes
// web/assets/map.jpg. Needs Playwright (local or global install).
// Usage: node rasterize.cjs projected.json [out.jpg]
const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

function loadPlaywright() {
  try { return require("playwright"); } catch (e) {
    const root = require("node:child_process").execSync("npm root -g").toString().trim();
    return require(join(root, "playwright"));
  }
}

(async () => {
  const [, , src, outArg] = process.argv;
  if (!src) throw new Error("usage: node rasterize.cjs projected.json [out.jpg]");
  const out = outArg || join(__dirname, "..", "..", "assets", "map.jpg");
  const data = JSON.parse(readFileSync(src, "utf8"));
  const layout = JSON.parse(readFileSync(join(__dirname, "..", "..", "data", "layout.json"), "utf8"));
  const stations = Object.values(layout.positions);
  const riverLabels = pickRiverLabels(layout, stations);
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("file://" + join(__dirname, "render.html"));
  const url = await page.evaluate(([d, s, o]) => window.render(d, s, o), [data, stations, { riverLabels, quality: 0.84 }]);
  await browser.close();
  writeFileSync(out, Buffer.from(url.split(",")[1], "base64"));
  console.log(`wrote ${out}`);
})().catch((e) => { console.error(e); process.exit(1); });

// Up to two spots on the river centreline, far from stations, with the text along the flow.
function pickRiverLabels(layout, stations) {
  const line = layout.river.line, out = [];
  for (let i = 2; i < line.length - 2; i++) {
    const [x, y] = line[i];
    if (x < 80 || y < 30 || x > layout.width - 80 || y > layout.height - 30) continue;
    const clearance = Math.min(...stations.map((p) => Math.hypot(p[0] - x, p[1] - y)));
    if (clearance < 62) continue;
    if (out.some((o) => Math.hypot(o.x - x, o.y - y) < 300)) continue;
    let a = Math.atan2(line[i + 2][1] - line[i - 2][1], line[i + 2][0] - line[i - 2][0]);
    if (a > Math.PI / 2) a -= Math.PI;
    if (a < -Math.PI / 2) a += Math.PI;
    out.push({ x, y, a, c: clearance });
  }
  return out.sort((p, q) => q.c - p.c).slice(0, 2);
}
