/* Find Mr. X rules engine: a pure reducer over game events, shared by solo play, the online
   referee and every verifying device. apply() throws on any illegal event.

   Events
     {t:"start", rules, dets:[station...]}              detective start positions (Mr. X's is secret)
     {t:"x", tk, dbl, rev, c}                           Mr. X used ticket tk; dbl marks either half of a
                                                         double move; rev is his station on reveal moves
                                                         (otherwise null); c is an optional commitment
     {t:"d", i, to, tk}                                 detective i moved
     {t:"probe", i, caught}                             Mr. X's answer after each detective move
     {t:"trapped"}                                      Mr. X has no legal move
   State.pending says what must come next: "x", "det", "probe" or "over". */
(function (FY) {
  "use strict";

  var TICKETS = ["taxi", "bus", "underground"];
  var X_TICKETS = ["taxi", "bus", "underground", "black"];

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // Snapshot of the rule values a game is played with.
  function makeRules(cfg, nDet) {
    var r = cfg || FY.CONFIG.rules;
    nDet = nDet || r.detectivePawns;
    var xT = clone(r.mrxTickets);
    xT.black = r.mrxBlack === "perDetective" ? nDet : r.mrxBlack;
    xT.double = r.mrxDoubles;
    return {
      rounds: r.rounds, reveals: r.reveals.slice(), nDet: nDet,
      detTickets: clone(r.detectiveTickets), xTickets: xT,
      ticketsToMrX: r.ticketsToMrX, blackRidesFerry: r.blackRidesFerry,
      trappedMrXLoses: r.trappedMrXLoses, stuckDetectivesLose: r.stuckDetectivesLose
    };
  }

  function shuffle(a, rand) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rand() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  // Draws start cards: detectives from the detective pool, Mr. X from his own pool.
  function setup(board, rules, rand) {
    rand = rand || Math.random;
    var dets = shuffle(board.starts.detective.slice(), rand).slice(0, rules.nDet);
    var pool = board.starts.mrx.filter(function (s) { return dets.indexOf(s) < 0; });
    var x = pool[Math.floor(rand() * pool.length)];
    return { start: { t: "start", rules: rules, dets: dets }, secret: { pos: x, start: x, route: [] } };
  }

  function init(board, start) {
    var R = start.rules;
    return {
      rules: R,
      dets: start.dets.map(function (p) { return { pos: p, t: clone(R.detTickets) }; }),
      xT: clone(R.xTickets),
      log: [], // Mr. X's travel log: {tk, dbl, rev}
      last: null, // {pos, move} of the latest reveal
      P: board.starts.mrx.filter(function (s) { return start.dets.indexOf(s) < 0; }), // possible Mr. X stations
      pending: "x", xStep: 0, dbl: false, turn: 1, moved: start.dets.map(function () { return false; }),
      probe: -1, winner: null, reason: "", xEnd: null,
      history: [{ k: "start", dets: start.dets.slice() }],
      events: [start]
    };
  }

  function occupied(s, except) {
    var o = {};
    s.dets.forEach(function (d, i) { if (i !== except) o[d.pos] = 1; });
    return o;
  }

  function detOptions(board, s, i) {
    var d = s.dets[i], occ = occupied(s, i), out = [];
    TICKETS.forEach(function (tk) {
      if (d.t[tk] > 0) board.adj[tk][d.pos].forEach(function (n) { if (!occ[n]) out.push({ to: n, tk: tk }); });
    });
    return out;
  }

  // Mr. X's legal moves from pos with the given tickets (defaults to his current ones).
  function xOptions(board, s, pos, tickets) {
    var t = tickets || s.xT, occ = occupied(s, -1), out = [];
    TICKETS.forEach(function (tk) {
      if (t[tk] > 0) board.adj[tk][pos].forEach(function (n) { if (!occ[n]) out.push({ to: n, tk: tk }); });
    });
    if (t.black > 0) {
      var nb = s.rules.blackRidesFerry ? board.neighbours[pos] : board.landNeighbours[pos];
      nb.forEach(function (n) { if (!occ[n]) out.push({ to: n, tk: "black" }); });
    }
    return out;
  }

  // Stations Mr. X could reach from any station in P with ticket tk.
  function spread(board, s, P, tk) {
    var occ = occupied(s, -1), seen = {}, out = [];
    P.forEach(function (p) {
      var list = tk === "black" ? (s.rules.blackRidesFerry ? board.neighbours[p] : board.landNeighbours[p]) : board.adj[tk][p];
      list.forEach(function (n) { if (!occ[n] && !seen[n]) { seen[n] = 1; out.push(n); } });
    });
    return out.sort(function (a, b) { return a - b; });
  }

  function canStartDouble(s) {
    return s.pending === "x" && s.xStep === 0 && s.xT.double > 0 && s.log.length <= s.rules.rounds - 2;
  }

  function fail(msg) { throw new Error("Illegal event: " + msg); }

  function endGame(s, winner, reason, xEnd) {
    s.pending = "over"; s.winner = winner; s.reason = reason;
    if (xEnd) s.xEnd = xEnd;
    s.history.push({ k: "end", winner: winner, reason: reason });
  }

  function detPhaseDone(board, s) {
    return s.dets.every(function (d, i) { return s.moved[i] || !detOptions(board, s, i).length; });
  }

  function beginDetPhase(board, s) {
    s.pending = "det";
    s.moved = s.dets.map(function () { return false; });
    var stuck = s.dets.map(function (d, i) { return !detOptions(board, s, i).length; });
    if (!stuck.every(Boolean)) return;
    if (s.rules.stuckDetectivesLose) {
      stuck.forEach(function (x, i) { s.history.push({ k: "skip", i: i, move: s.log.length, turn: s.turn }); });
      endGame(s, "x", s.log.length >= s.rules.rounds ? "Mr. X stayed hidden for all " + s.rules.rounds + " moves." : "No detective can move, so Mr. X escapes.");
    } else endDetPhase(board, s);
  }

  function endDetPhase(board, s) {
    s.dets.forEach(function (d, i) { if (!s.moved[i]) s.history.push({ k: "skip", i: i, move: s.log.length, turn: s.turn }); });
    if (s.log.length >= s.rules.rounds) return endGame(s, "x", "Mr. X stayed hidden for all " + s.rules.rounds + " moves.");
    s.pending = "x"; s.turn += 1;
  }

  function apply(board, s, ev) {
    if (s.pending === "over") fail("the game is over");
    if (ev.t === "x") {
      if (s.pending !== "x") fail("it is not Mr. X's turn");
      if (X_TICKETS.indexOf(ev.tk) < 0) fail("unknown ticket " + ev.tk);
      if (s.xStep === 0 && ev.dbl) {
        if (!canStartDouble(s)) fail("no double move available");
        s.xT.double -= 1; s.dbl = true;
      } else if (s.xStep === 1 && !ev.dbl) fail("second half of a double move expected");
      if (!(s.xT[ev.tk] > 0)) fail("Mr. X has no " + ev.tk + " ticket");
      s.xT[ev.tk] -= 1;
      var n = s.log.length + 1, isRev = s.rules.reveals.indexOf(n) >= 0;
      var next = spread(board, s, s.P, ev.tk);
      if (isRev) {
        if (typeof ev.rev !== "number") fail("move " + n + " must be revealed");
        if (next.indexOf(ev.rev) < 0) fail("revealed station " + ev.rev + " is not reachable with " + ev.tk);
        s.P = [ev.rev]; s.last = { pos: ev.rev, move: n };
      } else {
        if (ev.rev != null) fail("move " + n + " is not a reveal move");
        s.P = next;
      }
      s.log.push({ tk: ev.tk, dbl: !!ev.dbl, rev: isRev ? ev.rev : null, c: ev.c || null });
      var h = { k: "x", move: n, turn: s.turn, tk: ev.tk, dbl: !!ev.dbl, rev: isRev ? ev.rev : null, possible: s.P.length };
      if (isRev) h.dist = s.dets.map(function (d) { return board.distLand[d.pos][ev.rev]; });
      s.history.push(h);
      if (s.dbl && s.xStep === 0) s.xStep = 1;
      else { s.xStep = 0; s.dbl = false; beginDetPhase(board, s); }
    } else if (ev.t === "d") {
      if (s.pending !== "det") fail("it is not the detectives' turn");
      var i = ev.i | 0;
      if (i < 0 || i >= s.dets.length) fail("no detective " + i);
      if (s.moved[i]) fail("detective " + (i + 1) + " already moved");
      var ok = detOptions(board, s, i).some(function (o) { return o.to === ev.to && o.tk === ev.tk; });
      if (!ok) fail("detective " + (i + 1) + " cannot go to " + ev.to + " by " + ev.tk);
      var d = s.dets[i], from = d.pos;
      d.t[ev.tk] -= 1;
      if (s.rules.ticketsToMrX) s.xT[ev.tk] += 1;
      d.pos = ev.to; s.moved[i] = true;
      s.history.push({ k: "d", i: i, from: from, to: ev.to, tk: ev.tk, move: s.log.length, turn: s.turn });
      s.pending = "probe"; s.probe = i;
    } else if (ev.t === "probe") {
      if (s.pending !== "probe" || ev.i !== s.probe) fail("no capture check expected for detective " + ev.i);
      var at = s.dets[s.probe].pos;
      if (ev.caught) {
        s.history.push({ k: "caught", i: s.probe, pos: at, turn: s.turn });
        endGame(s, "det", "Detective " + (s.probe + 1) + " caught Mr. X at station " + at + ".", at);
      } else {
        s.P = s.P.filter(function (p) { return p !== at; });
        s.pending = "det"; s.probe = -1;
        if (detPhaseDone(board, s)) endDetPhase(board, s);
      }
    } else if (ev.t === "trapped") {
      if (s.pending !== "x" || s.xStep !== 0) fail("Mr. X can only be trapped at the start of his turn");
      if (!s.rules.trappedMrXLoses) fail("trapping is disabled");
      s.history.push({ k: "trapped", turn: s.turn });
      endGame(s, "det", "Mr. X is trapped with no legal move.");
    } else fail("unknown event " + ev.t);
    s.events.push(ev);
    return s;
  }

  function replay(board, events) {
    var s = init(board, events[0]);
    for (var k = 1; k < events.length; k++) apply(board, s, events[k]);
    s.events = events.slice();
    return s;
  }

  // ---- helpers for whoever holds Mr. X's secret position ----
  function canDouble(board, s, secret) {
    if (!canStartDouble(s)) return false;
    return xOptions(board, s, secret.pos).some(function (o) {
      var t = clone(s.xT); t[o.tk] -= 1;
      return xOptions(board, s, o.to, t).length > 0;
    });
  }
  // Builds Mr. X's event for a chosen option and advances the secret.
  function xMove(board, s, secret, opt, dbl) {
    var legal = xOptions(board, s, secret.pos).some(function (o) { return o.to === opt.to && o.tk === opt.tk; });
    if (!legal) fail("Mr. X cannot go to " + opt.to + " by " + opt.tk);
    var n = s.log.length + 1;
    var ev = { t: "x", tk: opt.tk, dbl: !!(dbl || s.xStep === 1), rev: s.rules.reveals.indexOf(n) >= 0 ? opt.to : null };
    secret.pos = opt.to;
    secret.route.push(opt.to);
    return ev;
  }
  function probeFor(s, secret) { return { t: "probe", i: s.probe, caught: s.dets[s.probe].pos === secret.pos }; }
  function isTrapped(board, s, secret) { return !xOptions(board, s, secret.pos).length; }

  // Mr. X's ticket counts implied by the public log (used to check his claims).
  function nextReveal(s) {
    var n = s.log.length;
    for (var k = 0; k < s.rules.reveals.length; k++) if (s.rules.reveals[k] > n) return s.rules.reveals[k];
    return null;
  }

  FY.Rules = {
    TICKETS: TICKETS, X_TICKETS: X_TICKETS,
    makeRules: makeRules, setup: setup, init: init, apply: apply, replay: replay, clone: clone,
    detOptions: detOptions, xOptions: xOptions, spread: spread, occupied: occupied,
    canStartDouble: canStartDouble, canDouble: canDouble, xMove: xMove, probeFor: probeFor,
    isTrapped: isTrapped, nextReveal: nextReveal, shuffle: shuffle
  };
})(window.FY = window.FY || {});
