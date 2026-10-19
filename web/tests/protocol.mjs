#!/usr/bin/env node
// Online protocol tests, no dependencies (Node's built-in WebCrypto). Plays signed games as
// three parties through the same verifier every browser runs, then tries to cheat:
// moving someone else's piece, changing a signed move, forging a signature, altering Mr. X's
// revealed route, and Mr. X lying that he wasn't caught. Every cheat must be detected.
// Usage: node web/tests/protocol.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = {};
const ctx = {
  console, Math, JSON, Promise, setTimeout, clearTimeout, setInterval, clearInterval, URLSearchParams, TextEncoder,
  crypto: globalThis.crypto, btoa: globalThis.btoa, atob: globalThis.atob, location: { search: "", href: "http://test/" },
  navigator: {}, document: { addEventListener() {}, querySelector() { return null; }, readyState: "complete" },
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } }
};
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ["data/board.js", "js/config.js", "js/store.js", "js/board.js", "js/rules.js", "js/ai.js", "js/game.js"]) vm.runInContext(readFileSync(join(web, f), "utf8"), ctx, { filename: f });
const FY = ctx.FY;
const board = FY.Board.build(ctx.FY_DATA);
FY.UI = { board, toast() {}, esc: (s) => s };
vm.runInContext(readFileSync(join(web, "js/net.js"), "utf8"), ctx, { filename: "js/net.js" });
const N = FY.Net, R = FY.Rules;

let failures = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { failures++; console.error("FAIL " + m); } };
const seeded = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const hexSalt = (r) => Array.from({ length: 16 }, () => Math.floor(r() * 256).toString(16).padStart(2, "0")).join("");

async function playGame({ seed, lieAboutCapture = false, referee = "verified" }) {
  const rand = seeded(seed), code = "TEST";
  const keys = { host: await N._keys(), mx: await N._keys(), det: await N._keys() };
  const roster = { host: { name: "GM", key: keys.host.pub }, mx: { name: "X", key: keys.mx.pub }, det: { name: "D", key: keys.det.pub } };
  const v = { code, entries: [], state: null, seats: null, settings: { referee }, roster: null, commit0: null, routeEntry: null, myId: "v" };
  const party = (id) => ({ code, state: v.state, keys: keys[id], myId: id });
  async function add(id, ev, expectOk = true) {
    const p = party(id); p.state = v.state;
    const entry = await N._sign(p, ev);
    entry.n = v.entries.length;
    const err = await N._verify(v, entry);
    if (expectOk) { ok(!err, "entry " + ev.t + " accepted: " + err); if (!err) N._apply(v, entry); }
    return { entry, err };
  }
  const nDet = 3, rules = R.makeRules(FY.CONFIG.rules, nDet), made = R.setup(board, rules, rand);
  await add("host", { t: "setup", seats: { mrx: referee === "trusted" ? "mx" : "mx", pawns: ["det", "det", "det"] }, players: roster, settings: { referee } });
  await add("host", made.start);
  const xa = referee === "trusted" ? "host" : "mx";
  const secret = { pos: made.secret.pos, start: made.secret.pos, route: [], salts: [hexSalt(rand)] };
  await add(xa, { t: "commit0", c: await N._sha(N._commit(code, 0, secret.start, secret.salts[0])) });
  let lied = false, detectedEarly = null, guard = 0;
  const tamper = {};
  while (v.state.pending !== "over" && guard++ < 1500) {
    const s = v.state;
    if (s.pending === "x") {
      if (R.isTrapped(board, s, secret)) { await add(xa, { t: "trapped" }); continue; }
      let plan = FY.AI.chooseX(board, s, secret, rand, "normal");
      if (lieAboutCapture && !lied) {
        // Walk into a detective's reach so a capture (and the lie about it) happens.
        const reach = (n) => s.dets.some((d) => R.TICKETS.some((tk) => d.t[tk] > 0 && board.adj[tk][d.pos].includes(n)));
        const bait = R.xOptions(board, s, secret.pos).find((o) => o.tk !== "black" && reach(o.to));
        if (bait) plan = { moves: [bait], double: false };
      }
      const o = plan.moves[0], k = s.log.length + 1;
      const ev = R.xMove(board, R.clone(s), secret, o, plan.double);
      secret.salts[k] = hexSalt(rand);
      ev.c = await N._sha(N._commit(code, k, o.to, secret.salts[k]));
      const r = await add(xa, ev, !lied);
      if (lied && r.err) { detectedEarly = r.err; break; }
      if (lied) N._apply(v, r.entry);
      if (plan.double && v.state.pending === "x" && v.state.xStep === 1) {
        // second half from the plan when still legal
        const o2 = plan.moves[1];
        if (R.xOptions(board, v.state, secret.pos).some((q) => q.to === o2.to && q.tk === o2.tk)) {
          const k2 = v.state.log.length + 1, ev2 = R.xMove(board, R.clone(v.state), secret, o2, true);
          secret.salts[k2] = hexSalt(rand);
          ev2.c = await N._sha(N._commit(code, k2, o2.to, secret.salts[k2]));
          const r2 = await add(xa, ev2, !lied);
          if (lied && r2.err) { detectedEarly = r2.err; break; }
          if (lied) N._apply(v, r2.entry);
        }
      }
    } else if (s.pending === "probe") {
      let p = R.probeFor(s, secret);
      if (p.caught && lieAboutCapture) { p = { ...p, caught: false }; lied = true; }
      await add(xa, p);
    } else {
      let mv = FY.AI.chooseDet(board, s, rand);
      if (lieAboutCapture) {
        s.dets.forEach((d, i) => { if (!s.moved[i]) R.detOptions(board, s, i).forEach((o) => { if (o.to === secret.pos) mv = { i, to: o.to, tk: o.tk }; }); });
      }
      const ev = { t: "d", ...mv };
      if (!tamper.done) {
        tamper.done = true;
        // 1) someone else moves a detective
        ok((await add("mx", ev, false)).err, "a detective moved by the wrong player is rejected");
        // 2) a signed move altered afterwards (another legal destination)
        const alt = R.detOptions(board, s, mv.i).find((o) => o.to !== mv.to);
        if (alt) {
          const { entry } = await add("det", ev, false);
          entry.ev = { t: "d", i: mv.i, to: alt.to, tk: alt.tk };
          ok(await N._verify(v, entry), "a move changed after signing is rejected");
        }
        // 3) forged signature
        const { entry: forged } = await add("det", ev, false);
        forged.sig = forged.sig.slice(0, -4) + (forged.sig.slice(-4) === "AAAA" ? "BBBB" : "AAAA");
        ok(await N._verify(v, forged), "a forged signature is rejected");
      }
      await add("det", ev);
    }
  }
  if (detectedEarly) return { detectedEarly, v };
  ok(v.state.pending === "over", "game " + seed + " finished");
  const route = [secret.start].concat(secret.route);
  await add(xa, { t: "route", route, salts: secret.salts });
  const res = await N._audit(v);
  return { v, route, audit: res, lied };
}

// Honest games audit cleanly.
for (const seed of [1, 2, 3]) {
  const g = await playGame({ seed });
  ok(g.audit && g.audit.ok, "honest game " + seed + " passes the audit " + JSON.stringify(g.audit && g.audit.problems));
  // 4) altered route
  const bad = { ...g.v, routeEntry: { ...g.v.routeEntry, route: g.route.slice() } };
  bad.routeEntry.route[2] = board.neighbours[bad.routeEntry.route[1]].find((n) => n !== g.route[2]) || g.route[2];
  const r = await N._audit(bad);
  ok(r && !r.ok, "game " + seed + ": an altered route fails the audit");
}
// 5) lying about a capture is detected (by the audit, or earlier by the rules)
let caughtLie = 0, lieGames = 0;
for (const seed of [11, 12, 13, 14, 15, 16]) {
  const g = await playGame({ seed, lieAboutCapture: true });
  if (g.detectedEarly) { lieGames++; caughtLie++; continue; }
  if (!g.lied) continue;
  lieGames++;
  if (g.audit && !g.audit.ok) caughtLie++;
}
ok(lieGames > 0 && caughtLie === lieGames, `capture lies detected in ${caughtLie} of ${lieGames} games`);
// Trusted mode: the game master authors Mr. X's entries.
const t = await playGame({ seed: 21, referee: "trusted" });
ok(t.audit && t.audit.ok, "trusted-mode game passes the audit");

console.log(`${checks} protocol checks, ${failures} failures (capture lies detected in ${caughtLie}/${lieGames} games)`);
process.exit(failures ? 1 : 0);
