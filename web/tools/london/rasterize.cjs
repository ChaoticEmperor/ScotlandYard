#!/usr/bin/env node
// Renders projected.json (project_osm.py) with render.html in headless Chromium and writes
// web/assets/map-london.jpg (the plain London style; the default board is tools/city). Needs Playwright (local or global install).
// Usage: node rasterize.cjs projected.json [out.jpg]
const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { pickRiverLabels } = require("./river-labels.cjs");

function loadPlaywright() {
  try { return require("playwright"); } catch (e) {
    const root = require("node:child_process").execSync("npm root -g").toString().trim();
    return require(join(root, "playwright"));
  }
}

(async () => {
  const [, , src, outArg] = process.argv;
  if (!src) throw new Error("usage: node rasterize.cjs projected.json [out.jpg]");
  const out = outArg || join(__dirname, "..", "..", "assets", "map-london.jpg");
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
