#!/usr/bin/env node
// Renders assets/icon.svg to the PNG app icons used by the web app manifest (needs Playwright).
// Usage: node web/tools/icons.cjs
const { join } = require("node:path");
function loadPlaywright() {
  try { return require("playwright"); } catch (e) {
    return require(join(require("node:child_process").execSync("npm root -g").toString().trim(), "playwright"));
  }
}
(async () => {
  const assets = join(__dirname, "..", "assets");
  const { chromium } = loadPlaywright();
  const b = await chromium.launch();
  for (const size of [192, 512]) {
    const p = await b.newPage({ viewport: { width: size, height: size } });
    await p.setContent(`<html><body style="margin:0;background:#1b2231"><img src="file://${join(assets, "icon.svg")}" style="width:${size}px;height:${size}px;display:block"></body></html>`);
    await p.waitForTimeout(200);
    await p.screenshot({ path: join(assets, `icon-${size}.png`) });
    await p.close();
  }
  await b.close();
  console.log("wrote assets/icon-192.png and assets/icon-512.png");
})();
