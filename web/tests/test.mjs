#!/usr/bin/env node
// Fog Yard tests: no dependencies. Run with `node web/tests/test.mjs [games]`.
// Checks the station graph, every ticket-type move generator, rule enforcement, and plays
// many AI-vs-AI games, checking invariants and that each game replays from its event log.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const ctx = { console, Math, JSON };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ["data/board.js", "js/config.js", "js/board.js", "js/rules.js", "js/ai.js"]) vm.runInContext(readFileSync(join(web, f), "utf8"), ctx, { filename: f });
const { Board, Rules: R, AI, CONFIG } = ctx.FY;
const graph = JSON.parse(readFileSync(join(web, "data/graph.json"), "utf8"));
const board = Board.build(ctx.FY_DATA);

let failures = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.error("FAIL " + msg); } };
const throws = (fn, msg) => { let t = false; try { fn(); } catch (e) { t = true; } ok(t, msg); };
const seeded = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// ---------- graph ----------
const N = graph.stations;
for (const [t, list] of Object.entries(graph.edges)) {
  const seen = new Set();
  for (const [a, b] of list) {
    ok(a >= 1 && a <= N && b >= 1 && b <= N && a !== b, `${t} edge ${a}-${b} valid`);
    ok(!seen.has(a + "-" + b), `${t} edge ${a}-${b} unique`);
    seen.add(a + "-" + b);
  }
}
for (const t of board.types) for (let a = 1; a <= N; a++) for (const b of board.adj[t][a]) ok(board.adj[t][b].includes(a), `${t} ${a}->${b} symmetric`);
for (let a = 1; a <= N; a++) ok(board.adj.taxi[a].length > 0, `station ${a} has a taxi link`);
{
  const seen = new Set([1]), st = [1];
  while (st.length) for (const b of board.landNeighbours[st.pop()]) if (!seen.has(b)) (seen.add(b), st.push(b));
  ok(seen.size === N, "graph connected over land transport");
}

// ---------- move generators ----------
{
  const rules = R.makeRules(CONFIG.rules, 1);
  for (let a = 1; a <= N; a++) {
    const s = R.init(board, { t: "start", rules, dets: [a] });
    for (const tk of R.TICKETS) {
      s.dets[0].t = { taxi: 0, bus: 0, underground: 0, [tk]: 1 };
      const got = R.detOptions(board, s, 0).map((o) => o.to).sort((x, y) => x - y);
      const want = board.adj[tk][a].slice().sort((x, y) => x - y);
      ok(JSON.stringify(got) === JSON.stringify(want), `detective ${tk} moves from ${a}`);
    }
    s.dets[0].t = { taxi: 9, bus: 9, underground: 9 };
    ok(R.detOptions(board, s, 0).every((o) => !board.adj.ferry[a].includes(o.to) || board.landNeighbours[a].includes(o.to)), `detectives never sail from ${a}`);
    // Mr. X at a, detective parked far away.
    const far = a === 1 ? 199 : 1;
    const sx = R.init(board, { t: "start", rules, dets: [far] });
    for (const tk of R.X_TICKETS) {
      const t = { taxi: 0, bus: 0, underground: 0, black: 0, double: 0, [tk]: 1 };
      const got = [...new Set(R.xOptions(board, sx, a, t).map((o) => o.to))].sort((x, y) => x - y);
      const want = (tk === "black" ? board.neighbours[a] : board.adj[tk][a]).filter((n) => n !== far).sort((x, y) => x - y);
      ok(JSON.stringify(got) === JSON.stringify(want), `Mr. X ${tk} moves from ${a}`);
    }
  }
  // Ferries only with black tickets.
  const [fa, fb] = graph.edges.ferry[0];
  const s = R.init(board, { t: "start", rules, dets: [1] });
  ok(!R.xOptions(board, s, fa, { taxi: 9, bus: 9, underground: 9, black: 0 }).some((o) => o.to === fb && !board.landNeighbours[fa].includes(fb)), "ferry needs a black ticket");
  ok(R.xOptions(board, s, fa, { taxi: 0, bus: 0, underground: 0, black: 1 }).some((o) => o.to === fb), "black ticket rides the ferry");
}

// ---------- rule enforcement ----------
{
  const rules = R.makeRules(CONFIG.rules, 5);
  ok(rules.xTickets.black === 5 && rules.xTickets.double === 2 && rules.xTickets.taxi === 4, "Mr. X starts with 4/3/3, black = detectives, 2 doubles");
  const { start, secret } = R.setup(board, rules, seeded(3));
  ok(new Set(start.dets).size === 5 && !start.dets.includes(secret.pos), "start positions distinct");
  const s = R.init(board, start);
  throws(() => R.apply(board, R.clone(s), { t: "d", i: 0, to: board.adj.taxi[start.dets[0]][0], tk: "taxi" }), "detectives cannot move before Mr. X");
  throws(() => R.apply(board, R.clone(s), { t: "x", tk: "taxi", dbl: false, rev: 5 }), "move 1 cannot carry a reveal");
  const s2 = R.clone(s); s2.xT.bus = 0;
  throws(() => R.apply(board, s2, { t: "x", tk: "bus", dbl: false, rev: null }), "no ticket, no move");
  // Play to the first reveal and lie about it.
  const s3 = R.clone(s), sec = R.clone(secret);
  for (let m = 0; m < 2; m++) {
    const o = R.xOptions(board, s3, sec.pos)[0];
    R.apply(board, s3, R.xMove(board, s3, sec, o, false));
    while (s3.pending === "det" || s3.pending === "probe") {
      if (s3.pending === "probe") { R.apply(board, s3, R.probeFor(s3, sec)); continue; }
      const mv = AI.chooseDet(board, s3, seeded(m));
      R.apply(board, s3, { t: "d", ...mv });
    }
  }
  if (s3.pending === "x") {
    const o = R.xOptions(board, s3, sec.pos)[0];
    const ev = R.xMove(board, s3, sec, o, false);
    ok(ev.rev === o.to, "move 3 reveals Mr. X");
    const bad = { ...ev, rev: [...Array(N).keys()].map((k) => k + 1).find((n) => !R.spread(board, s3, s3.P, ev.tk).includes(n)) };
    throws(() => R.apply(board, R.clone(s3), bad), "a reveal inconsistent with the tickets is rejected");
  }
}

// ---------- AI vs AI games ----------
const games = Number(process.argv[2] || 300);
const tally = { x: 0, det: 0 }, reasons = {}, byDet = {};
let totalMoves = 0;
for (let g = 0; g < games; g++) {
  const rand = seeded(1000 + g);
  const nDet = 2 + (g % 6);
  const rules = R.makeRules(CONFIG.rules, nDet);
  const { start, secret } = R.setup(board, rules, rand);
  const s = R.init(board, start);
  let guard = 0;
  while (s.pending !== "over" && guard++ < 2000) {
    if (s.pending === "x") {
      if (R.isTrapped(board, s, secret)) { R.apply(board, s, { t: "trapped" }); break; }
      const plan = AI.chooseX(board, s, secret, rand);
      plan.moves.forEach((o, k) => R.apply(board, s, R.xMove(board, s, secret, o, plan.double)));
      ok(s.P.includes(secret.pos) || s.pending === "over", `game ${g}: Mr. X's station stays in the possible set`);
    } else if (s.pending === "probe") R.apply(board, s, R.probeFor(s, secret));
    else {
      const mv = AI.chooseDet(board, s, rand);
      R.apply(board, s, { t: "d", ...mv });
    }
    const pos = s.dets.map((d) => d.pos);
    ok(new Set(pos).size === pos.length, `game ${g}: detectives never share a station`);
    ok(s.dets.every((d) => Object.values(d.t).every((v) => v >= 0)) && Object.values(s.xT).every((v) => v >= 0), `game ${g}: tickets never negative`);
  }
  ok(s.pending === "over", `game ${g} finished`);
  ok(s.log.length <= rules.rounds, `game ${g} within ${rules.rounds} moves`);
  const again = R.replay(board, s.events);
  ok(JSON.stringify(again.dets) === JSON.stringify(s.dets) && again.winner === s.winner && JSON.stringify(again.P) === JSON.stringify(s.P), `game ${g} replays from its events`);
  tally[s.winner]++;
  byDet[nDet] = byDet[nDet] || { x: 0, det: 0 }; byDet[nDet][s.winner]++;
  reasons[s.reason.replace(/\d+/g, "#")] = (reasons[s.reason.replace(/\d+/g, "#")] || 0) + 1;
  totalMoves += s.log.length;
}
console.log(`${games} AI games: Mr. X ${tally.x}, detectives ${tally.det}; average ${(totalMoves / games).toFixed(1)} Mr. X moves`);
console.log(reasons);
console.log("by detective count:", JSON.stringify(byDet));
console.log(`${checks} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);
