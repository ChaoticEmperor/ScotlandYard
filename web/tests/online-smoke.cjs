#!/usr/bin/env node
// Online smoke test (needs Playwright with Chromium). Serves web/ locally and plays full
// three-player games through the real page, using the same-browser transport (?transport=local):
// a game master and two guests, lobby roles, a guest reload (rejoin) and a host reload (resume),
// in verified and trusted referee modes. Fails on page errors or failed rule checks.
// Usage: node web/tests/online-smoke.cjs [outDir]
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const web = path.join(__dirname, "..");
const out = process.argv[2] || null;

function loadPlaywright() {
  try { return require("playwright"); } catch (e) {
    const root = require("node:child_process").execSync("npm root -g").toString().trim();
    return require(path.join(root, "playwright"));
  }
}
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".png": "image/png" };
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = path.join(web, decodeURIComponent(req.url.split("?")[0]).replace(/^\/$/, "/index.html"));
      if (!p.startsWith(web) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" });
      fs.createReadStream(p).pipe(res);
    }).listen(0, "127.0.0.1", () => resolve(srv));
  });
}

(async () => {
  // FY_TRANSPORT=peer plays over real PeerJS/WebRTC (needs internet; honours HTTPS_PROXY).
  const peer = process.env.FY_TRANSPORT === "peer";
  const srv = await serve();
  const base = peer ? "file://" + path.join(web, "index.html") + "?profile=" : "http://127.0.0.1:" + srv.address().port + "/index.html?transport=local&profile=";
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch(peer && process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: peer });
  if (!peer) await ctx.route(/cdn\.jsdelivr\.net/, (r) => r.abort());
  const errors = [];
  async function open(name) {
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(name + ": " + e.message));
    await page.goto(base + name);
    if (name === "h") await page.evaluate(() => localStorage.clear());
    await page.evaluate((n) => { const k = "fogyard." + n + ".settings"; localStorage.setItem(k, JSON.stringify({ tips: false, name: n.toUpperCase() })); }, name);
    await page.reload();
    return page;
  }
  async function playUntilOver(pages, opts) {
    let reloaded = false, resumed = false;
    for (let step = 0; step < 900; step++) {
      for (const [name, page] of Object.entries(pages)) {
        const over = await page.evaluate(() => { const c = FY.UI.controller; return !!(c && c.s && c.s.pending === "over"); }).catch(() => false);
        if (over) return true;
        const btn = await page.$("#vPlay .mv .tkb button");
        if (btn) await btn.click().catch(() => {});
      }
      const moves = await pages.h.evaluate(() => (FY.UI.controller && FY.UI.controller.s ? FY.UI.controller.s.log.length : 0)).catch(() => 0);
      if (opts.reloadGuest && !reloaded && moves >= 4) {
        reloaded = true;
        await pages.b.reload(); // no clicks: a refresh must drop the player straight back in
        await pages.b.waitForSelector("#game:not(.hidden)", { timeout: 15000 });
        console.log("  guest b rejoined at move", moves);
      }
      if (opts.reloadHost && !resumed && moves >= 8) {
        resumed = true;
        const saved = await pages.h.evaluate(() => { const v = localStorage.getItem("fogyard.h.host"); return v ? { len: v.length, over: JSON.parse(v).over, entries: JSON.parse(v).entries.length } : null; });
        const keys = await pages.h.evaluate(() => Object.keys(localStorage).map((k) => k + ":" + localStorage.getItem(k).length));
        if (!saved) console.log("  no host save; storage:", keys.join(" "));
        await pages.h.reload();
        await pages.h.waitForSelector("#game:not(.hidden)", { timeout: 15000 });
        console.log("  host resumed at move", moves);
      }
      await pages.h.waitForTimeout(80);
    }
    return false;
  }

  async function game(referee, xPlayer, opts) {
    const h = await open("h"), a = await open("a"), b = await open("b");
    await h.click("#mOnline");
    await h.click("[data-net=host]");
    await h.waitForSelector(".codebig");
    const code = (await h.textContent(".codebig")).trim();
    for (const g of [a, b]) {
      await g.click("#mOnline");
      await g.fill("#nCode", code);
      await g.click("[data-net=join]");
    }
    await h.waitForFunction(() => document.querySelectorAll(".pl").length === 3, null, { timeout: 15000 });
    if (opts.reloadHost) {
      // Refreshing the game master's page in the lobby keeps the code and the players.
      await h.reload();
      await h.waitForFunction((c) => { const el = document.querySelector(".codebig"); return el && el.textContent.trim() === c && document.querySelectorAll(".pl").length === 3 && !document.querySelector(".pl .off"); }, code, { timeout: 20000 })
        .catch(async () => errors.push("lobby after host refresh: " + (await h.textContent("#onlineInner")).slice(0, 200)));
    }
    // The future Mr. X picks an alias from their own lobby screen.
    const xPage = { h, a, b }[xPlayer];
    await xPage.click("[data-net=editme]");
    await xPage.fill("#eAlias", "Moriarty");
    await xPage.click("[data-net=saveme]");
    await h.waitForFunction(() => document.querySelector("#onlineInner").textContent.includes("Moriarty ("), null, { timeout: 10000 });
    await h.click('[data-ref="' + referee + '"]');
    await h.click('[data-ndet="3"]');
    const ids = await h.evaluate(() => Object.keys(FY.Net.session.players));
    // Give Mr. X to the requested player: guests are listed in join order (a, then b).
    const guestIds = ids.filter((id) => id !== "host");
    const target = xPlayer === "h" ? "host" : guestIds[xPlayer === "a" ? 0 : 1];
    await h.click('[data-role="x"][data-pid="' + target + '"]');
    for (const id of ids) if (id !== target) await h.click('[data-role="det"][data-pid="' + id + '"]');
    if (out) await h.screenshot({ path: path.join(out, "lobby-" + referee + ".png") });
    await h.click("[data-net=start]");
    for (const p of [h, a, b]) await p.waitForSelector("#game:not(.hidden)", { timeout: 15000 });
    const done = await playUntilOver({ h, a, b }, opts);
    await h.waitForTimeout(800);
    const summary = [];
    for (const [n, p] of [["h", h], ["a", a], ["b", b]]) {
      const r = await p.evaluate(() => {
        const c = FY.UI.controller, s = c.s, sess = FY.Net.session;
        return { xLabel: c.xLabel(), pending: s.pending, winner: s.winner, reason: s.reason, moves: s.log.length, entries: sess.entries.length, audit: sess.audit, problem: sess.problem || null, view: c.view, humanX: c.humanX };
      });
      summary.push(n + ": " + JSON.stringify(r));
      if (r.problem) errors.push(referee + " " + n + ": " + r.problem);
      if (!/^Moriarty \(/.test(r.xLabel)) errors.push(referee + " " + n + ": Mr. X's alias not shown (" + r.xLabel + ")");
      if (r.pending !== "over") errors.push(referee + " " + n + ": game not over");
      if (referee === "verified" && (!r.audit || !r.audit.ok)) errors.push(referee + " " + n + ": audit missing or failed " + JSON.stringify(r.audit));
    }
    const lens = new Set(summary.map((l) => JSON.parse(l.slice(3)).entries));
    if (lens.size !== 1) errors.push(referee + ": devices disagree on the log length");
    console.log(referee + " game (Mr. X = " + xPlayer + "):", done ? "finished" : "DID NOT FINISH");
    summary.forEach((l) => console.log("  " + l));
    if (out) { await a.screenshot({ path: path.join(out, "online-" + referee + "-a.png") }); await h.screenshot({ path: path.join(out, "online-" + referee + "-h.png") }); }
    for (const p of [h, a, b]) await p.close();
  }

  // An 8-player game: Mr. X plus seven detectives, each on their own device.
  async function bigGame() {
    const names = ["h", "a", "b", "c", "d", "e", "f", "g"], pages = {};
    for (const n of names) pages[n] = await open(n);
    const h = pages.h;
    await h.click("#mOnline"); await h.click("[data-net=host]"); await h.waitForSelector(".codebig");
    const code = (await h.textContent(".codebig")).trim();
    for (const n of names.slice(1)) { const g = pages[n]; await g.click("#mOnline"); await g.fill("#nCode", code); await g.click("[data-net=join]"); await h.waitForTimeout(150); }
    await h.waitForFunction(() => document.querySelectorAll(".pl").length === 8, null, { timeout: 20000 });
    await pages.a.click("[data-net=editme]"); await pages.a.fill("#eAlias", "Moriarty"); await pages.a.click("[data-net=saveme]");
    const guestIds = (await h.evaluate(() => Object.keys(FY.Net.session.players))).filter((id) => id !== "host");
    await h.click('[data-role="x"][data-pid="' + guestIds[0] + '"]');
    await h.click('[data-role="det"][data-pid="host"]');
    await h.waitForFunction(() => FY.Net.session.settings.nDet === 7, null, { timeout: 5000 }).catch(() => errors.push("8 players: lobby did not raise the detectives to 7"));
    if (out) await h.screenshot({ path: path.join(out, "lobby-8.png"), fullPage: true });
    await h.click("[data-net=start]");
    for (const n of names) await pages[n].waitForSelector("#game:not(.hidden)", { timeout: 20000 });
    const done = await playUntilOver(pages, {});
    await h.waitForTimeout(1000);
    const res = [];
    for (const n of names) res.push(await pages[n].evaluate(() => { const c = FY.UI.controller, s = FY.Net.session; return { dets: c.s.dets.length, mine: c.myDets.length, entries: s.entries.length, audit: s.audit && s.audit.ok, problem: s.problem || null, x: c.xLabel(), over: c.s.pending, reason: c.s.reason }; }));
    console.log("8-player game:", done ? "finished" : "DID NOT FINISH", JSON.stringify(res[0]));
    if (new Set(res.map((r) => r.entries)).size !== 1) errors.push("8 players: devices disagree on the log");
    res.forEach((r, k) => { if (r.problem || r.audit !== true || r.over !== "over") errors.push("8 players, " + names[k] + ": " + JSON.stringify(r)); });
    if (res[0].dets !== 7 || res.filter((r) => r.mine === 1).length !== 7) errors.push("8 players: expected 7 detectives, one each");
    if (out) await pages.c.screenshot({ path: path.join(out, "online-8-c.png") });
    for (const n of names) await pages[n].close();
  }

  // The game master only watches: sees Mr. X, removes a detective (the computer takes over),
  // and finally a game where Mr. X is removed, which ends it.
  async function gmGame() {
    const h = await open("h"), a = await open("a"), b = await open("b");
    await h.click("#mOnline"); await h.click("[data-net=host]"); await h.waitForSelector(".codebig");
    const code = (await h.textContent(".codebig")).trim();
    for (const g of [a, b]) { await g.click("#mOnline"); await g.fill("#nCode", code); await g.click("[data-net=join]"); }
    await h.waitForFunction(() => document.querySelectorAll(".pl").length === 3, null, { timeout: 15000 });
    const ids = (await h.evaluate(() => Object.keys(FY.Net.session.players))).filter((id) => id !== "host");
    await h.click('[data-role="x"][data-pid="' + ids[0] + '"]');
    await h.click('[data-role="watch"][data-pid="host"]');
    await h.click('[data-role="det"][data-pid="' + ids[1] + '"]');
    const sees = await h.isChecked("[data-net=gmsees]");
    if (!sees) errors.push("gm: 'game master can watch Mr. X' should default on");
    await h.click("[data-net=start]");
    for (const p of [h, a, b]) await p.waitForSelector("#game:not(.hidden)", { timeout: 15000 });
    // Play a few moves, then compare what the game master sees with Mr. X's real position.
    for (let k = 0; k < 40 && (await h.evaluate(() => FY.UI.controller.s.log.length)) < 3; k++) {
      for (const p of [a, b]) { const btn = await p.$("#vPlay .mv .tkb button"); if (btn) await btn.click().catch(() => {}); }
      await h.waitForTimeout(150);
    }
    await h.waitForTimeout(600);
    const truth = await a.evaluate(() => FY.Net.session.secret.pos);
    const gm = await h.evaluate(() => ({ view: FY.UI.controller.view, pos: FY.UI.controller.secret && FY.UI.controller.secret.pos }));
    if (gm.view !== "x" || gm.pos !== truth) errors.push("gm: game master should see Mr. X at " + truth + ", saw " + JSON.stringify(gm));
    else console.log("  game master sees Mr. X at", truth);
    // Remove the detective player: their pieces go to the computer.
    await h.click("#gMenu"); await h.click("[data-act=seats]");
    await h.click('[data-remove="' + ids[1] + '"]');
    await h.selectOption("#rmTo", "ai");
    await h.click("#rmGo");
    await b.waitForFunction(() => /removed you/.test(document.body.textContent), null, { timeout: 10000 }).catch(() => errors.push("gm: removed player not told"));
    const done = await playUntilOver({ h, a }, {});
    await h.waitForTimeout(1000);
    const r = await h.evaluate(() => ({ over: FY.UI.controller.s.pending, ai: FY.Net.session.seats.pawns.every((p) => p === "ai"), audit: FY.Net.session.audit && FY.Net.session.audit.ok, problem: FY.Net.session.problem || null, reason: FY.UI.controller.s.reason }));
    console.log("gm game (computer took over the detectives):", done ? "finished" : "DID NOT FINISH", JSON.stringify(r));
    if (!r.ai || r.over !== "over" || r.audit !== true || r.problem) errors.push("gm: " + JSON.stringify(r));
    // Rematch with the same lobby, then remove Mr. X: a verified game ends.
    for (const p of [h, a, b]) await p.close();
  }

  // Two human detectives plus computer detectives; map pieces show the players' initials, or
  // their photo if they added one.
  async function mixedGame() {
    const h = await open("h"), a = await open("a"), b = await open("b");
    await h.evaluate(() => { const k = "fogyard.h.settings", s = JSON.parse(localStorage.getItem(k)); s.name = "Paul David"; localStorage.setItem(k, JSON.stringify(s)); localStorage.removeItem("fogyard.h.resume"); localStorage.removeItem("fogyard.h.host"); });
    await b.evaluate(() => { const k = "fogyard.b.settings", s = JSON.parse(localStorage.getItem(k)); s.name = "David"; s.alias = "Holmes"; localStorage.setItem(k, JSON.stringify(s)); localStorage.removeItem("fogyard.b.resume"); });
    // The earlier games may leave a "resume" record; clear it so the reload shows the menu.
    await h.reload(); await b.reload();
    await h.click("#mOnline"); await h.click("[data-net=host]"); await h.waitForSelector(".codebig");
    const code = (await h.textContent(".codebig")).trim();
    for (const g of [a, b]) { await g.click("#mOnline"); await g.fill("#nCode", code); await g.click("[data-net=join]"); }
    await h.waitForFunction(() => document.querySelectorAll(".pl").length === 3, null, { timeout: 15000 });
    // b adds a photo from the lobby's Edit form; every device then shows it instead of initials.
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEklEQVR4nGP4z8CAB+GTG8HSALfKY52fTcuYAAAAAElFTkSuQmCC", "base64");
    await b.click("[data-net=editme]");
    await b.setInputFiles("[data-photo-input]", { name: "me.png", mimeType: "image/png", buffer: png });
    await b.waitForSelector("[data-photo-field] .av img");
    await b.click("[data-net=saveme]");
    await h.waitForFunction(() => document.querySelectorAll("#onlineInner .plist .av img").length === 1, null, { timeout: 8000 }).catch(() => errors.push("mixed: host lobby does not show the photo"));
    await a.waitForFunction(() => document.querySelectorAll("#onlineInner .plist .av img").length === 1, null, { timeout: 8000 }).catch(() => errors.push("mixed: guest lobby does not show the photo"));
    const ids = (await h.evaluate(() => Object.keys(FY.Net.session.players))).filter((id) => id !== "host");
    await h.click('[data-role="x"][data-pid="' + ids[0] + '"]');
    await h.click('[data-ndet="5"]');
    await h.click('[data-extra="computer"]');
    await h.click("[data-net=start]");
    for (const p of [h, a, b]) await p.waitForSelector("#game:not(.hidden)", { timeout: 15000 });
    const seats = await h.evaluate(() => FY.Net.session.seats.pawns);
    if (JSON.stringify(seats) !== JSON.stringify(["host", ids[1], "ai", "ai", "ai"])) errors.push("mixed: seats " + JSON.stringify(seats));
    await a.waitForTimeout(500);
    const labels = await a.evaluate(() => [...document.querySelectorAll("#mapbox .tok .tokt")].map((t) => t.textContent));
    for (const want of ["PD", "D3", "D4", "D5"]) if (!labels.includes(want)) errors.push("mixed: map label " + want + " missing in " + JSON.stringify(labels));
    const photos = await a.evaluate(() => [...document.querySelectorAll("#mapbox .tok")].filter((g) => g.querySelector("image")).length);
    if (photos !== 1 || labels.includes("Ho")) errors.push("mixed: Holmes's piece should show the photo (" + photos + " photo pieces, labels " + JSON.stringify(labels) + ")");
    // Detectives go by their alias (or name) in text: "Holmes to move", "Holmes (David)" in the log.
    const names = await a.evaluate(() => [0, 1, 2].map((i) => FY.UI.controller.pieceName(i)).concat(FY.UI.controller.pieceFullName(1)));
    if (JSON.stringify(names) !== JSON.stringify(["Paul David", "Holmes", "", "Holmes (David)"])) errors.push("mixed: names " + JSON.stringify(names));
    const done = await playUntilOver({ h, a, b }, {});
    await a.waitForSelector("#overlay:not(.hidden)", { timeout: 8000 }).catch(() => {});
    await a.evaluate(() => FY.UI.closeLayers()); await a.click("#tLog");
    const logText = await a.textContent("#vLog");
    if (!/Holmes \(David\)/.test(logText) || /\bD2\b/.test(logText)) errors.push("mixed: log does not use the alias");
    const r = await h.evaluate(() => ({ over: FY.UI.controller.s.pending, aiMoves: FY.UI.controller.s.history.filter((e) => e.k === "d" && e.i >= 2).length, audit: FY.Net.session.audit && FY.Net.session.audit.ok, problem: FY.Net.session.problem || null }));
    console.log("mixed game (2 players + 3 computer detectives):", done ? "finished" : "DID NOT FINISH", "labels", JSON.stringify(labels), JSON.stringify(r));
    if (r.over !== "over" || !r.aiMoves || r.audit !== true || r.problem) errors.push("mixed: " + JSON.stringify(r));
    for (const p of [h, a, b]) await p.close();
  }

  async function removeXGame() {
    const h = await open("h"), a = await open("a"), b = await open("b");
    await h.click("#mOnline"); await h.click("[data-net=host]"); await h.waitForSelector(".codebig");
    const code = (await h.textContent(".codebig")).trim();
    for (const g of [a, b]) { await g.click("#mOnline"); await g.fill("#nCode", code); await g.click("[data-net=join]"); }
    await h.waitForFunction(() => document.querySelectorAll(".pl").length === 3, null, { timeout: 15000 });
    const ids = (await h.evaluate(() => Object.keys(FY.Net.session.players))).filter((id) => id !== "host");
    await h.click('[data-role="x"][data-pid="' + ids[0] + '"]');
    await h.click("[data-net=start]");
    for (const p of [h, a, b]) await p.waitForSelector("#game:not(.hidden)", { timeout: 15000 });
    await h.waitForTimeout(800);
    await h.click("#gMenu"); await h.click("[data-act=seats]");
    await h.click('[data-remove="' + ids[0] + '"]');
    await h.click("#rmGo");
    await b.waitForFunction(() => FY.UI.controller && FY.UI.controller.s.pending === "over", null, { timeout: 10000 }).catch(() => errors.push("removing Mr. X did not end the game"));
    console.log("remove Mr. X:", await b.evaluate(() => FY.UI.controller.s.reason));
    for (const p of [h, a, b]) await p.close();
  }

  if (process.env.FY_PLAYERS === "8") await bigGame();
  else if (process.env.FY_GM) { await gmGame(); await removeXGame(); await mixedGame(); }
  else if (peer) await game("verified", "a", { reloadGuest: true });
  else {
    await game("verified", "a", { reloadGuest: true, reloadHost: true });
    await game("trusted", "b", { reloadGuest: true });
    await game("verified", "h", {});
    await gmGame();
    await removeXGame();
    await mixedGame();
  }
  await browser.close();
  srv.close();
  if (errors.length) { console.error("FAILURES:\n" + errors.join("\n")); process.exit(1); }
  console.log("Online smoke test passed");
})().catch((e) => { console.error(e); process.exit(1); });
