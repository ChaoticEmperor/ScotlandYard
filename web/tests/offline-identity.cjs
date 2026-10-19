#!/usr/bin/env node
// Offline cache and identity tests (needs Playwright with Chromium). Serves web/ over HTTP so
// the service worker runs, then checks:
//  - after one online visit, the site loads and a solo game plays with the network off;
//  - one player can't hold two seats: a second tab takes the seat over, the game master's
//    own browser can't join as a guest, and a removed player can't rejoin.
// Usage: node web/tests/offline-identity.cjs
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const web = path.join(__dirname, "..");
function loadPlaywright() {
  try { return require("playwright"); } catch (e) {
    return require(path.join(require("node:child_process").execSync("npm root -g").toString().trim(), "playwright"));
  }
}
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".png": "image/png" };
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = path.join(web, decodeURIComponent(req.url.split("?")[0]).replace(/\/$/, "/index.html"));
      if (!p.startsWith(web) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" });
      fs.createReadStream(p).pipe(res);
    }).listen(0, "127.0.0.1", () => resolve(srv));
  });
}

(async () => {
  const srv = await serve();
  const origin = "http://127.0.0.1:" + srv.address().port;
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const errors = [];
  const check = (c, m) => { if (!c) errors.push(m); else console.log("ok  " + m); };

  // ---------- offline ----------
  {
    const ctx = await browser.newContext();
    await ctx.route(/cdn\.jsdelivr\.net/, (r) => r.abort());
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push("offline page: " + e.message));
    await page.goto(origin + "/index.html");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller || location.reload() || true);
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 });
    await ctx.setOffline(true);
    await page.reload();
    check(await page.isVisible("#mSoloX"), "the menu loads with the network off");
    await page.evaluate(() => localStorage.setItem("fogyard.settings", JSON.stringify({ tips: false })));
    await page.click("#mSoloX"); await page.click("#sStart");
    for (let k = 0; k < 120 && (await page.evaluate(() => FY.UI.controller.s.log.length < 3 && FY.UI.controller.s.pending !== "over")); k++) { const b = await page.$(".mv .tkb button"); if (b) await b.click(); await page.waitForTimeout(250); }
    const moves = await page.evaluate(() => FY.UI.controller.s.log.length), over = await page.evaluate(() => FY.UI.controller.s.pending === "over");
    check(moves >= 3 || (over && moves >= 1), "a solo game plays offline (" + moves + " moves" + (over ? ", game over" : "") + ")");
    const bg = await page.evaluate(() => { const i = document.querySelector("#mapbox image"); return !!(i && i.getAttribute("href")); });
    check(bg, "the map image loads offline");
    await ctx.close();
  }

  // ---------- one player, one seat ----------
  {
    const ctx = await browser.newContext();
    await ctx.route(/cdn\.jsdelivr\.net/, (r) => r.abort());
    const open = async (profile) => {
      const p = await ctx.newPage();
      p.on("pageerror", (e) => errors.push(profile + ": " + e.message));
      await p.goto(origin + "/index.html?transport=local&profile=" + profile);
      await p.evaluate((n) => localStorage.setItem("fogyard." + n + ".settings", JSON.stringify({ tips: false, name: n.toUpperCase() })), profile);
      await p.reload();
      return p;
    };
    const join = async (p, code) => {
      if (await p.isVisible("#mOnline")) await p.click("#mOnline");
      if (!(await p.isVisible("#nCode"))) await p.click("[data-net=back]").then(() => p.click("#mOnline")).catch(() => {});
      await p.fill("#nCode", code); await p.click("[data-net=join]");
    };
    const host = await open("h");
    await host.click("#mOnline"); await host.click("[data-net=host]"); await host.waitForSelector(".codebig");
    const code = (await host.textContent(".codebig")).trim();
    const players = () => host.evaluate(() => Object.keys(FY.Net.session.players).length);

    const a1 = await open("a");
    await join(a1, code);
    await host.waitForFunction(() => Object.keys(FY.Net.session.players).length === 2, null, { timeout: 10000 });
    const a2 = await open("a"); // the same player in a second tab: it must not silently join twice
    await a2.waitForSelector("[data-net=steal]", { timeout: 10000 }).catch(() => errors.push("second tab did not offer to take over"));
    check(await players() === 2, "a second tab doesn't add a second seat on its own");
    await a2.click("[data-net=steal]");
    await a2.waitForSelector(".codebig", { timeout: 10000 }).catch(() => errors.push("taking over in the second tab failed"));
    await a1.waitForFunction(() => /another tab/.test(document.querySelector("#onlineInner").textContent), null, { timeout: 10000 }).catch(() => {});
    await host.waitForTimeout(800);
    check(await players() === 2, "a second tab of the same player takes over the seat instead of adding a player");
    check(/another tab/.test(await a1.textContent("#onlineInner")), "the first tab is told the game moved to another tab");

    const hostAsGuest = await open("h"); // the game master's own browser in a second tab
    await hostAsGuest.waitForFunction(() => /already open in another tab/.test(document.body.textContent), null, { timeout: 10000 }).catch(() => {});
    check(/already open in another tab/.test(await hostAsGuest.textContent("body")), "a second tab of the game master doesn't host the game twice");
    await join(hostAsGuest, code);
    await hostAsGuest.waitForFunction(() => /already the game master/.test(document.querySelector("#onlineInner").textContent), null, { timeout: 10000 }).catch(() => {});
    check(/already the game master/.test(await hostAsGuest.textContent("#onlineInner")), "the game master's browser can't also join as a guest");
    check(await players() === 2, "no extra player was added for the game master's browser");

    // A player marked away comes back by itself as soon as their next message arrives.
    const aid = await host.evaluate(() => { const S = FY.Net.session; const id = Object.keys(S.players).find((k) => k !== "host"); S.players[id].online = false; return id; });
    await host.waitForFunction((id) => FY.Net.session.players[id].online, aid, { timeout: 8000 }).then(() => check(true, "an away player is shown online again by their next message"), () => check(false, "an away player stayed offline"));
    const b = await open("b");
    await join(b, code);
    await host.waitForFunction(() => Object.keys(FY.Net.session.players).length === 3, null, { timeout: 10000 });
    const bid = await host.evaluate(() => Object.keys(FY.Net.session.players).find((id) => FY.Net.session.players[id].name === "B"));
    await host.click('[data-net="kick"][data-pid="' + bid + '"]');
    await b.waitForFunction(() => /removed you/.test(document.querySelector("#onlineInner").textContent), null, { timeout: 10000 }).catch(() => {});
    check(/removed you/.test(await b.textContent("#onlineInner")), "a removed player is told so");
    await join(b, code);
    await b.waitForTimeout(1200);
    check(await players() === 2 && /removed you/.test(await b.textContent("#onlineInner")), "a removed player can't rejoin");
    await ctx.close();
  }

  await browser.close();
  srv.close();
  if (errors.length) { console.error("FAILURES:\n" + errors.join("\n")); process.exit(1); }
  console.log("Offline and identity tests passed");
})().catch((e) => { console.error(e); process.exit(1); });
