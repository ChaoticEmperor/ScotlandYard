#!/usr/bin/env node
// Headless UI smoke test (needs Playwright with Chromium): plays solo games through the real
// page by tapping move cards, at phone and desktop sizes, and fails on any page error.
// Usage: node web/tests/ui-smoke.cjs [outDir]
const { join } = require("node:path");
function loadPlaywright() {
  try { return require("playwright"); } catch (e) {
    const root = require("node:child_process").execSync("npm root -g").toString().trim();
    return require(join(root, "playwright"));
  }
}
const out = process.argv[2] || null;
(async () => {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const errors = [];
  async function play(role, viewport, shotName, extra) {
    extra = extra || {};
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
    page.on("pageerror", (e) => errors.push(role + ": " + e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/peerjs|ERR_|Failed to load resource/i.test(m.text())) errors.push(role + " console: " + m.text()); });
    await page.goto("file://" + join(__dirname, "..", "index.html"));
    await page.evaluate((x) => { localStorage.clear(); localStorage.setItem("fogyard.settings", JSON.stringify({ tips: !!x.tips, tactical: !!x.tactical })); }, extra);
    await page.reload();
    await page.click(role === "x" ? "#mSoloX" : "#mSoloDet");
    await page.click("#sStart");
    let turns = 0;
    for (let k = 0; k < 400; k++) {
      const over = await page.evaluate(() => FY.UI.controller && FY.UI.controller.s.pending === "over");
      if (over) break;
      const btn = await page.$(".mv .tkb button");
      if (btn) { await btn.click(); turns++; if (shotName && turns === 6 && out) await page.screenshot({ path: join(out, shotName + "-play.png") }); }
      else await page.waitForTimeout(200);
    }
    const s = await page.evaluate(() => { const c = FY.UI.controller; return { pending: c.s.pending, winner: c.s.winner, reason: c.s.reason, moves: c.s.log.length }; });
    const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (hscroll) errors.push(role + ": horizontal page scroll at " + viewport.width + "px");
    if (out && shotName) {
      await page.screenshot({ path: join(out, shotName + "-end.png") });
      await page.click("#overlay [data-act=close]").catch(() => {});
      await page.evaluate(() => FY.UI.closeLayers());
      await page.click("#tLog").catch(() => {});
      await page.screenshot({ path: join(out, shotName + "-log.png") });
      await page.click("#tMap").catch(() => {});
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(out, shotName + "-map.png") });
    }
    if (extra.replay) {
      await page.evaluate(() => FY.UI.closeLayers());
      await page.click("#tPlay");
      await page.click("#vPlay [data-act=replay]");
      for (let k = 0; k < 5; k++) await page.click('#replayBar [data-rp="1"]');
      const label = await page.textContent("#replayBar .rl");
      if (!/^6\//.test(label)) errors.push(role + ": replay did not step (" + label + ")");
      if (out) await page.screenshot({ path: join(out, shotName + "-replay.png") });
      await page.click('#replayBar [data-rp="x"]');
      await page.click("#tPlay").catch((e) => errors.push(role + ": Play tab: " + e.message.split("\n")[0]));
      const tab = await page.getAttribute("#game", "data-tab");
      if (out) await page.screenshot({ path: join(out, shotName + "-afterreplay.png") });
      if (tab !== "play") errors.push(role + ": tab is " + tab + " after replay");
      await page.click("#vPlay [data-act=rematch]", { timeout: 5000 });
      const fresh = await page.evaluate(() => FY.UI.controller.s.events.length);
      if (fresh > 2) errors.push(role + ": rematch did not start a new game");
    }
    console.log(role, viewport.width + "px:", JSON.stringify(s), "after", turns, "taps");
    if (s.pending !== "over") errors.push(role + ": game did not finish");
    await page.close();
  }
  await play("det", { width: 360, height: 740 }, "det360", { tactical: true, replay: true });
  await play("x", { width: 390, height: 844 }, "x390", { tactical: true, tips: true });
  await play("det", { width: 1280, height: 800 }, "det1280");
  await browser.close();
  if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
  console.log("UI smoke test passed");
})().catch((e) => { console.error(e); process.exit(1); });
