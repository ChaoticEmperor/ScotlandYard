#!/usr/bin/env node
// Renders the illustrated city board with render-city.html in headless Chromium and writes
// web/assets/map.jpg. Inputs come from the London pipeline (see tools/london/README.md):
// projected.json (project_osm.py) and landmarks.json (landmarks.py). Needs Playwright.
// Usage: node rasterize-city.cjs projected.json landmarks.json [out.jpg] [scale]
const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { pickRiverLabels } = require("../london/river-labels.cjs");

function loadPlaywright() {
  try { return require("playwright"); } catch (e) {
    const root = require("node:child_process").execSync("npm root -g").toString().trim();
    return require(join(root, "playwright"));
  }
}

const web = join(__dirname, "..", "..");
const ringArea = (r, sc) => {
  let a = 0;
  for (let i = 0; i < r.length - 2; i += 2) a += r[i] * r[i + 3] - r[i + 2] * r[i + 1];
  return Math.abs(a) / 2 / (sc * sc);
};

(async () => {
  const [, , projPath, landPath, outArg, scaleArg] = process.argv;
  if (!projPath || !landPath) throw new Error("usage: node rasterize-city.cjs projected.json landmarks.json [out.jpg] [scale]");
  const osm = JSON.parse(readFileSync(projPath, "utf8"));
  const layout = JSON.parse(readFileSync(join(web, "data", "layout.json"), "utf8"));
  const graph = JSON.parse(readFileSync(join(web, "data", "graph.json"), "utf8"));

  // The same scene geometry the game draws, so bus curves and roads line up exactly.
  global.window = {};
  require(join(web, "data", "board.js"));
  require(join(web, "js", "board.js"));
  require(join(web, "js", "scene.js"));
  const board = window.FY.Board.build(window.FY_DATA);
  const scene = window.FY.Scene.compose(board);
  const curves = scene.routes.filter((r) => r.e.t === "bus" && !r.lanes).map((r) => r.pts);

  const g = layout.geo;
  const toPx = ([lon, lat]) => [((lon - g.lon0) * g.kx - g.mx0) / g.metresPerPx, (-(lat - g.lat0) * g.ky - g.my0) / g.metresPerPx];
  const landmarks = JSON.parse(readFileSync(landPath, "utf8"))
    .map((l) => { const [x, y] = toPx(l.at); return { name: l.name, icon: l.icon, x, y }; })
    .filter((l) => l.x > 25 && l.y > 25 && l.x < layout.width - 25 && l.y < layout.height - 25);

  const positions = [null];
  for (let i = 1; i <= graph.stations; i++) positions.push(layout.positions[i]);
  const input = {
    W: layout.width, H: layout.height, scale: Number(scaleArg || 2), positions,
    stations: positions.slice(1), taxi: graph.edges.taxi, curves,
    lines: scene.routes.filter((r) => r.e.t === "underground").map((r) => r.pts).concat(scene.ferries.map((r) => r.pts)),
    osm: { scale: osm.scale, water: osm.water, roads: osm.roads, green: osm.green.filter((f) => ringArea(f.p, osm.scale) > 12).map((f) => ({ ...f, big: ringArea(f.p, osm.scale) > 40 })) },
    parks: osm.labels.filter((l) => l.k === "park" && l.a > 2500 && !/Garden$|Cemetery/.test(l.t)),
    landmarks, riverLabels: pickRiverLabels(layout, positions.slice(1)), quality: 0.86,
  };
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto("file://" + join(__dirname, "render-city.html"));
  const url = await page.evaluate((inp) => window.renderCity(inp), input);
  console.log(await page.evaluate(() => window.__stats));
  await browser.close();
  const out = outArg || join(web, "assets", "map.jpg");
  writeFileSync(out, Buffer.from(url.split(",")[1], "base64"));
  console.log(`wrote ${out}`);
})().catch((e) => { console.error(e); process.exit(1); });
