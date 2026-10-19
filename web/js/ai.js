/* Find Mr. X computer players.
   Mr. X: prefers stations far from every detective, with many exits detectives can't cover next
   turn, while keeping the detectives' list of possible stations large and saving scarce tickets.
   Detectives: track the possible Mr. X stations (state.P) and spread out to cover them,
   pouncing when the list is small. */
(function (FY) {
  "use strict";
  var R = FY.Rules;

  // Can detective d reach station n on its next move?
  function reaches(board, d, n) {
    for (var k = 0; k < R.TICKETS.length; k++) {
      var tk = R.TICKETS[k];
      if (d.t[tk] > 0 && board.adj[tk][d.pos].indexOf(n) >= 0) return true;
    }
    return false;
  }

  function scoreSpot(board, s, n, move, tickets) {
    var dets = s.dets, minD = 99, danger = 0;
    dets.forEach(function (d) {
      minD = Math.min(minD, board.distLand[d.pos][n]);
      if (d.pos !== n && reaches(board, d, n)) danger++;
    });
    var exits = 0;
    board.neighbours[n].forEach(function (m) {
      if (dets.some(function (d) { return d.pos === m || reaches(board, d, m); })) return;
      exits++;
    });
    var reveal = s.rules.reveals.indexOf(move) >= 0;
    var score = 3 * Math.min(minD, 5) - 15 * danger + 1.3 * Math.min(exits, 6);
    if (reveal) score += 1.6 * Math.min(minD, 5) + 0.8 * Math.min(exits, 6);
    // Ending a move on a junction gives more ways out next turn.
    score += board.kind[n] === "underground" ? 1 : board.kind[n] === "bus" ? 0.5 : 0;
    return { score: score, danger: danger, minD: minD };
  }

  function ticketCost(s, tk, tickets, afterReveal, danger) {
    var c = { taxi: 0, bus: 0.5, underground: 1.3, black: 3.2 }[tk];
    if (tk === "black" && (afterReveal || danger)) c = 0.6;
    if (tickets[tk] <= 1) c += 1.2;
    return c;
  }

  // level: "easy" (careless, rarely uses specials), "normal" or "hard" (calculates everything).
  var NOISE = { easy: 7, normal: 3.2, hard: 0.6 };
  function chooseX(board, s, secret, rand, level) {
    rand = rand || Math.random;
    level = NOISE[level] ? level : "normal";
    var noise = NOISE[level];
    var move = s.log.length + 1, afterReveal = s.last && s.last.move === s.log.length;
    var opts = R.xOptions(board, s, secret.pos);
    if (!opts.length) return null;
    var nowDanger = scoreSpot(board, s, secret.pos, move, s.xT).danger;

    function evalOpt(o, tickets, mv) {
      var sp = scoreSpot(board, s, o.to, mv, tickets);
      var amb = s.rules.reveals.indexOf(mv) >= 0 || level === "easy" ? 0 : Math.log2(R.spread(board, s, s.P, o.tk).length + 1);
      var dangerWeight = level === "hard" ? 1 : level === "normal" ? 0.75 : 0.45;
      return sp.score + 15 * (1 - dangerWeight) * sp.danger + 0.9 * amb - ticketCost(s, o.tk, tickets, afterReveal, nowDanger) + rand() * noise;
    }
    var best = null;
    opts.forEach(function (o) {
      var v = evalOpt(o, s.xT, move);
      if (!best || v > best.v) best = { v: v, moves: [o] };
    });
    var bestSpot = scoreSpot(board, s, best.moves[0].to, move, s.xT);
    var wantsDouble = level === "easy" ? bestSpot.danger > 1 : bestSpot.danger > 0 || nowDanger > 1 || (afterReveal && bestSpot.minD <= 1);
    if (R.canDouble(board, s, secret) && wantsDouble) {
      var bd = null;
      opts.forEach(function (o1) {
        var t2 = R.clone(s.xT); t2[o1.tk] -= 1;
        R.xOptions(board, s, o1.to, t2).forEach(function (o2) {
          if (o2.to === secret.pos && rand() < 0.7) return;
          var v = scoreSpot(board, s, o2.to, move + 1, t2).score - ticketCost(s, o1.tk, s.xT, afterReveal, 1) - ticketCost(s, o2.tk, t2, false, 1) - 4 + rand() * noise;
          if (!bd || v > bd.v) bd = { v: v, moves: [o1, o2] };
        });
      });
      if (bd && bd.v > best.v + 3) return { moves: bd.moves, double: true };
    }
    return { moves: best.moves, double: false };
  }

  // How many moves a detective could make from pos with tickets t (ignoring other pieces).
  function mobility(board, pos, t) {
    var n = 0;
    R.TICKETS.forEach(function (tk) { if (t[tk] > 0) n += board.adj[tk][pos].length; });
    return n;
  }

  // Picks the next detective move: the best (detective, option) pair over all unmoved detectives.
  // Mr. X moves before the detectives move again, so the team covers where he could go NEXT
  // (P spread by every ticket he holds): lower is better = fewer safe escapes for him, a short
  // average distance to them, a chance of landing on him now, and careful ticket use.
  var DET_NOISE = { easy: 1.4, normal: 0.12, hard: 0.03 };
  function chooseDet(board, s, rand, only, level) {
    rand = rand || Math.random;
    var noise = DET_NOISE[level] || DET_NOISE.normal;
    var P = s.P.length ? s.P : board.starts.mrx;
    var next = {};
    R.X_TICKETS.forEach(function (tk) {
      if (s.xT[tk] > 0 || (tk !== "black" && s.rules.ticketsToMrX)) R.spread(board, s, P, tk).forEach(function (n) { next[n] = 1; });
    });
    var P2 = Object.keys(next).map(Number);
    if (!P2.length) P2 = P;
    var left = Math.max(1, s.rules.rounds - s.log.length);
    var revealNext = s.rules.reveals.indexOf(s.log.length + 1) >= 0;
    var best = null;
    s.dets.forEach(function (d, i) {
      if (s.moved[i] || (only && only.indexOf(i) < 0)) return;
      var opts = R.detOptions(board, s, i);
      if (!opts.length) return;
      var others = s.dets.filter(function (o, j) { return j !== i; });
      var otherReach = {};
      P2.forEach(function (q) { if (others.some(function (x) { return x.pos === q || reaches(board, x, q); })) otherReach[q] = 1; });
      opts.forEach(function (o) {
        var t2 = R.clone(d.t); t2[o.tk] -= 1;
        var me = { pos: o.to, t: t2 }, team = others.concat([me]), safe = 0, sum = 0;
        P2.forEach(function (q) {
          if (!otherReach[q] && q !== o.to && !reaches(board, me, q)) safe++;
          var m = 99;
          for (var k = 0; k < team.length; k++) if (board.distLand[team[k].pos][q] < m) m = board.distLand[team[k].pos][q];
          sum += Math.min(m, 8);
        });
        var v = 5 * (safe / P2.length) + 0.45 * (sum / P2.length);
        if (P.indexOf(o.to) >= 0) v -= 6 / P.length;
        if (revealNext) v -= board.kind[o.to] === "underground" ? 0.5 : board.kind[o.to] === "bus" ? 0.25 : 0;
        v += 0.7 * Math.min(left, 12) / (d.t[o.tk] * 3 + 1);
        var mob = mobility(board, o.to, t2);
        if (!mob) v += 8; else if (mob < 3) v += 0.6;
        v += rand() * noise;
        if (!best || v < best.v) best = { v: v, i: i, to: o.to, tk: o.tk };
      });
    });
    return best && { i: best.i, to: best.to, tk: best.tk };
  }

  FY.AI = { chooseX: chooseX, chooseDet: chooseDet };
})(window.FY = window.FY || {});
