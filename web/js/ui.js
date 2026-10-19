/* Fog Yard user interface: menus, solo setup, the Play / Map / Log views, move cards with
   learning and tactical cues, the travel log, tips, the end screen, replay and dialogs.
   Online play (net.js) reuses the same game screen through FY.UI.enterGame(controller). */
(function (FY) {
  "use strict";
  var R = FY.Rules, S = FY.Store, C = FY.CONFIG;
  var $ = function (q) { return document.querySelector(q); };
  var TK = {
    taxi: { n: "Taxi", s: "T" }, bus: { n: "Bus", s: "B" }, underground: { n: "Underground", s: "U" },
    black: { n: "Black", s: "?" }, double: { n: "Double", s: "2×" }, ferry: { n: "Ferry", s: "F" }
  };
  var DCOL = ["#2563eb", "#db2777", "#7c3aed", "#ea580c", "#0e7490"];
  var KIND = { taxi: "Taxi stop", bus: "Bus stop", underground: "Underground" };

  var board, scene, bg = null, mv = null, mini = null, ctl = null;
  var ui = { tab: "play", sel: -1, armDouble: false, filter: "all", replay: null, toastQ: [], lastTurnKey: "" };
  var settings = S.settings();

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function tkDot(tk, label) { return '<span class="tkd bg-' + tk + '">' + (label || TK[tk].s) + "</span>"; }
  function detName(i) { return "D" + (i + 1); }
  function wide() { return window.matchMedia("(min-width: 900px)").matches; }

  // ---------- theme ----------
  function applyTheme() {
    var t = settings.theme;
    if (t === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
  }

  // ---------- screens ----------
  function show(id) {
    ["menu", "setup", "online", "game"].forEach(function (s) { $("#" + s).classList.toggle("hidden", s !== id); });
    closeLayers();
  }
  function closeLayers() { $("#sheet").classList.add("hidden"); $("#overlay").classList.add("hidden"); }
  function overlay(html, onMount) {
    $("#overlayCard").innerHTML = html;
    $("#overlay").classList.remove("hidden");
    if (onMount) onMount($("#overlayCard"));
    var first = $("#overlayCard").querySelector("button, input");
    if (first) first.focus();
  }
  function sheet(html, onMount) {
    $("#sheetCard").innerHTML = html;
    $("#sheet").classList.remove("hidden");
    if (onMount) onMount($("#sheetCard"));
  }

  function refreshMenu() {
    var saved = S.get("solo", null), b = $("#mContinue");
    if (saved && saved.events && saved.events.length > 1) {
      b.classList.remove("hidden");
      var moves = saved.events.filter(function (e) { return e.t === "x"; }).length;
      $("#mContinueInfo").textContent = "Solo, playing " + (saved.opts.role === "x" ? "Mr. X" : "the detectives") + ", after " + moves + " of Mr. X's moves.";
    } else b.classList.add("hidden");
  }

  // ---------- solo setup ----------
  var setupRole = "det";
  function seg(el, values, current, labels, onPick) {
    el.innerHTML = values.map(function (v, k) {
      return '<button type="button" role="radio" aria-checked="' + (v === current) + '" data-v="' + v + '">' + (labels ? labels[k] : v) + "</button>";
    }).join("");
    el.onclick = function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      el.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-checked", x === b); });
      onPick(b.getAttribute("data-v"));
    };
  }
  function openSetup(role) {
    setupRole = role;
    $("#sTitle").textContent = role === "x" ? "Solo: play Mr. X" : "Solo: play the detectives";
    var nd = [];
    for (var n = C.rules.minDetectivePawns; n <= C.rules.maxDetectivePawns; n++) nd.push(String(n));
    seg($("#sDets"), nd, String(settings.detectives), null, function (v) { settings = S.saveSetting("detectives", +v); note(); });
    seg($("#sLevel"), ["easy", "normal", "hard"], settings.level, ["Easy", "Normal", "Hard"], function (v) { settings = S.saveSetting("level", v); });
    $("#sTactical").checked = settings.tactical;
    $("#sTactical").onchange = function () { settings = S.saveSetting("tactical", this.checked); };
    function note() {
      var n = settings.detectives;
      $("#sNote").textContent = role === "x"
        ? "You start with " + C.rules.mrxTickets.taxi + " taxi, " + C.rules.mrxTickets.bus + " bus, " + C.rules.mrxTickets.underground + " underground, " + n + " black and " + C.rules.mrxDoubles + " double-move tickets, plus every ticket the detectives spend."
        : "You control all " + n + " detectives. Mr. X shows himself after moves " + C.rules.reveals.join(", ") + ".";
    }
    note();
    show("setup");
  }
  function startSolo() {
    var c = new FY.Controller(board, { mode: "solo", role: setupRole, nDet: settings.detectives, level: settings.level });
    c.newGame();
    enterGame(c);
  }
  function continueSolo() {
    var saved = S.get("solo", null);
    if (!saved) return;
    try {
      var c = new FY.Controller(board, saved.opts);
      c.resume(saved);
      enterGame(c);
    } catch (e) {
      S.set("solo", null);
      refreshMenu();
      toast("That saved game could not be restored.", "It was made with different rules and has been cleared.");
    }
  }

  // ---------- game screen ----------
  function ensureMaps() {
    if (mv) return;
    mv = new FY.MapView($("#mapbox"), board, scene, { onTap: onTap });
    $("#zIn").onclick = function () { mv.zoomBy(1.4); };
    $("#zOut").onclick = function () { mv.zoomBy(1 / 1.4); };
    $("#zFit").onclick = function () { mv.fit(); };
    $("#zMe").onclick = function () { focusMine(true); };
    if (bg) mv.setBackground(bg.url, bg.painted);
  }

  function enterGame(c) {
    if (ctl) ctl.destroy();
    ctl = c;
    ui.sel = -1; ui.armDouble = false; ui.filter = "all"; ui.replay = null; ui.lastTurnKey = ""; ui.endShown = false;
    show("game");
    ensureMaps();
    if (mini) { mini.svg.remove(); mini = null; }
    setTab(wide() ? "play" : "play");
    ctl.on(function (ev) { onEvent(ev); });
    $("#replayBar").classList.add("hidden");
    mv.resize();
    render();
    focusMine(true);
    tip(ctl.view === "x" ? "welcome-x" : "welcome-det");
  }

  function setTab(t) {
    if (wide() && t === "map") t = "play";
    ui.tab = t;
    $("#game").setAttribute("data-tab", t);
    ["play", "map", "log"].forEach(function (k) { $("#t" + k[0].toUpperCase() + k.slice(1)).setAttribute("aria-selected", k === t); });
    if (t === "map" && mv) mv.resize();
    if (t === "log") renderLog();
    if (t === "play") renderPlay();
  }

  function onEvent(ev) {
    var s = ctl.s;
    if (ev && ev.t === "x" && ctl.view !== "x") {
      if (ev.rev != null) tip("reveal");
      if (ev.tk === "black") tip("black-seen");
      if (ev.dbl && s.xStep === 0) tip("double-seen");
    }
    if (ev && ev.t === "d" && s.history.length) tip("handover");
    if (s.history.some(function (h) { return h.k === "skip"; })) tip("stuck");
    if (s.pending === "over" && !ui.endShown) { ui.endShown = true; render(); setTimeout(showEnd, 500); return; }
    render();
  }

  // ---------- derived view data ----------
  function myTurn() {
    if (!ctl || ui.replay) return null;
    if (ctl.isMyXTurn()) return "x";
    if (ctl.myTurnDets().length) return "det";
    return null;
  }
  function selectedDet() {
    var mine = ctl.myTurnDets();
    if (mine.indexOf(ui.sel) < 0) ui.sel = mine.length ? mine[0] : -1;
    return ui.sel;
  }
  function currentOptions() {
    var who = myTurn();
    if (who === "x") return ctl.xOptions();
    if (who === "det") { var i = selectedDet(); return i >= 0 ? R.detOptions(board, ctl.s, i) : []; }
    return [];
  }
  function groupByStation(opts) {
    var by = {}, order = [];
    opts.forEach(function (o) { if (!by[o.to]) { by[o.to] = []; order.push(o.to); } by[o.to].push(o.tk); });
    order.sort(function (a, b) { return a - b; });
    return order.map(function (n) { return { to: n, tks: by[n] }; });
  }
  function xVisible() {
    // Where this device may draw Mr. X: always for Mr. X; for detectives only on a reveal move.
    var s = ctl.s;
    if (ui.replay) return null;
    if (s.pending === "over") return s.xEnd || (ctl.route() ? ctl.route().slice(-1)[0] : (s.last && s.last.pos));
    if (ctl.view === "x" && ctl.secret) return ctl.secret.pos;
    if (s.last && s.last.move === s.log.length && s.pending !== "x") return s.last.pos;
    return null;
  }
  function detectivesReach(n) {
    var s = ctl.s, c = 0;
    s.dets.forEach(function (d) {
      if (R.TICKETS.some(function (tk) { return d.t[tk] > 0 && board.adj[tk][d.pos].indexOf(n) >= 0; })) c++;
    });
    return c;
  }
  function tacticalOn() { return !!settings.tactical && (!ctl.allowTactical || ctl.allowTactical()); }

  // ---------- render ----------
  function render() {
    if (!ctl) return;
    renderBar();
    renderTravel();
    renderMap();
    if (ui.tab === "play" || wide()) renderPlay();
    if (ui.tab === "log") renderLog();
    var key = (myTurn() || "-") + ctl.s.events.length;
    if (myTurn() && key !== ui.lastTurnKey) {
      ui.lastTurnKey = key;
      if (settings.vibrate && navigator.vibrate) try { navigator.vibrate(25); } catch (e) {}
      focusMine(false);
    }
  }

  function statusText() {
    var s = ctl.s, who = myTurn();
    if (ui.replay) return { h: "Replay", p: ui.replay.label };
    if (s.pending === "over") return { h: s.winner === "x" ? "Mr. X wins" : "The detectives win", p: s.reason };
    if (ctl.offline) return { h: "Connection lost", p: "Reconnecting to the game master…", think: true };
    var nr = R.nextReveal(s), next = s.log.length + 1;
    var revTxt = nr ? (nr === next ? "Mr. X's next move is a reveal move." : "Mr. X surfaces after move " + nr + " (" + (nr - s.log.length) + " moves away).") : "No reveals left.";
    if (who === "x") {
      return { h: s.xStep === 1 ? "Second half of your double move" : "Your move, Mr. X", p: (nr === next ? "Careful: this move will be shown to the detectives." : revTxt), mine: true };
    }
    if (who === "det") {
      var i = selectedDet();
      return { h: detName(i) + " to move", p: lastXText() + " " + (nr === next ? "Mr. X shows himself after his next move." : revTxt), mine: true };
    }
    if (ctl.busy || ctl.waitingFor) {
      var w = ctl.waitingFor || (s.pending === "x" ? "Mr. X is slipping through the fog" : "The detectives are closing in");
      return { h: w, p: s.pending === "x" ? revTxt : lastXText(), think: true };
    }
    return { h: s.pending === "x" ? "Mr. X is moving" : "Detectives are moving", p: lastXText(), think: true };
  }
  function lastXText() {
    var s = ctl.s, e = s.log[s.log.length - 1];
    if (!e) return "Mr. X has not moved yet.";
    var t = "Mr. X used " + (e.tk === "black" ? "a black ticket" : TK[e.tk].n.toLowerCase()) + (e.dbl ? " (double move)" : "") + ".";
    if (s.last && s.last.move === s.log.length) t = "Mr. X surfaced at station " + s.last.pos + "!";
    else if (s.last) t += " Last seen at " + s.last.pos + " after move " + s.last.move + ".";
    if (ctl.view !== "x" && tacticalOn()) t += " He could be at " + s.P.length + " stations.";
    return t;
  }

  function renderBar() {
    var s = ctl.s, n = Math.min(s.log.length + (s.pending === "x" ? 1 : 0), s.rules.rounds) || 1;
    $("#gRound").textContent = s.pending === "over" ? "Game over" : "Move " + n + " of " + s.rules.rounds;
    var st = statusText();
    $("#gStatus").textContent = st.h;
  }

  function renderTravel() {
    var s = ctl.s, route = ctl.view === "x" || s.pending === "over" ? ctl.route() : null, h = "";
    for (var m = 1; m <= s.rules.rounds; m++) {
      var e = s.log[m - 1], isRev = s.rules.reveals.indexOf(m) >= 0, cur = m === s.log.length + 1 && s.pending !== "over";
      var pos = e && (e.rev || (route && route[m]));
      h += '<div class="lc' + (isRev ? " rev" : "") + (cur ? " cur" : "") + '" title="Move ' + m + (isRev ? " (reveal)" : "") + '"' + (cur ? ' data-cur="1"' : "") + ">" +
        "<span>" + (isRev ? "★" : "") + m + "</span>" +
        (e ? '<span class="tk bg-' + e.tk + '">' + TK[e.tk].s + "</span>" : '<span class="tk e"></span>') +
        '<span class="p">' + (pos || (e && e.dbl ? "2×" : "")) + "</span></div>";
    }
    $("#travelIn").innerHTML = h;
    var cc = $("#travelIn [data-cur]"), w = $("#travel");
    if (cc) w.scrollLeft = cc.offsetLeft - w.clientWidth / 2 + 19;
  }

  function tokens() {
    var s = ctl.s, out = [], i;
    var mine = ctl.myTurnDets();
    if (ui.replay) {
      var f = ui.replay.frames[ui.replay.k];
      f.dets.forEach(function (p, j) { out.push({ id: "d" + j, n: p, label: detName(j), color: DCOL[j % DCOL.length] }); });
      if (f.x) out.push({ id: "x", n: f.x, label: "X", color: "#111", ring: "#e0b341", text: "#e0b341" });
      return out;
    }
    var xv = xVisible();
    if (!xv && s.last && ctl.view !== "x") out.push({ id: "xg", n: s.last.pos, label: "X", color: "#555", ring: "#e0b341", text: "#e0b341", ghost: true, tag: "seen " + s.last.move });
    for (i = 0; i < s.dets.length; i++) {
      out.push({ id: "d" + i, n: s.dets[i].pos, label: detName(i), color: DCOL[i % DCOL.length], halo: i === ui.sel && mine.indexOf(i) >= 0, tag: String(s.dets[i].pos) });
    }
    if (xv) out.push({ id: "x", n: xv, label: "X", color: "#111", ring: "#e0b341", text: "#e0b341", tag: String(xv) });
    return out;
  }
  function highlights() {
    var s = ctl.s, hl = [];
    if (ui.replay) return hl;
    if (tacticalOn() && ctl.view !== "x" && s.pending !== "over") s.P.forEach(function (p) { hl.push({ n: p, cls: "maybe", r: 22 }); });
    if (tacticalOn() && ctl.view === "x" && myTurn() === "x") {
      var seen = {};
      s.dets.forEach(function (d) { board.landNeighbours[d.pos].forEach(function (n) { if (!seen[n] && detectivesReach(n)) { seen[n] = 1; hl.push({ n: n, cls: "danger", r: 22 }); } }); });
    }
    groupByStation(currentOptions()).forEach(function (g) { hl.push({ n: g.to, cls: "move" }); });
    return hl;
  }
  function renderMap() {
    if (!mv) return;
    mv.highlight(highlights());
    var t = tokens();
    mv.setTokens(t);
    if (mini) { mini.highlight(highlights()); mini.setTokens(t); }
  }
  function myPiecePos() {
    var who = myTurn();
    if (who === "x" || (ctl.view === "x" && ctl.secret)) return ctl.secret.pos;
    var i = who === "det" ? selectedDet() : (ctl.myDets.length ? ctl.myDets[0] : -1);
    return i >= 0 ? ctl.s.dets[i].pos : (ctl.s.last ? ctl.s.last.pos : null);
  }
  function focusMine(force) {
    var p = myPiecePos();
    if (!p) return;
    if (mini) mini.focus(p, 0.85);
    if (mv && (force || ui.tab === "map" || wide())) mv.focus(p, Math.max(mv.scale(), wide() ? 0.9 : 1));
  }

  // ---------- play view ----------
  function renderPlay() {
    var s = ctl.s, st = statusText(), who = myTurn(), h = '<div class="pv">';
    h += '<div class="status' + (st.mine ? " mine" : "") + '"><h3' + (st.think ? ' class="think"' : "") + ">" + esc(st.h) + "</h3><p>" + esc(st.p) + "</p></div>";
    if (s.pending === "over" && !ui.replay) {
      h += '<div class="row"><button class="btn pri grow" data-act="rematch">Rematch</button><button class="btn grow" data-act="replay">Replay</button><button class="btn grow" data-act="log">Activity log</button></div>';
    }
    if (ctl.view === "x") h += xPanel(who);
    if (who === "det") h += pickerRow();
    if (who) {
      var groups = groupByStation(currentOptions());
      h += '<div class="sect">' + (who === "x" ? "Where to?" : "Moves for " + detName(selectedDet())) + "</div>";
      h += groups.length ? '<div class="moves">' + groups.map(function (g) { return moveCard(g); }).join("") + "</div>" : '<div class="empty">No legal moves.</div>';
    }
    h += '<div class="sect">Detectives</div>' + detPanel(who);
    h += '<div class="sect">Around ' + (ctl.view === "x" ? "you" : "your detective") + '</div><div id="minimap"><span class="minicap">Tap to open the map</span></div>';
    h += '<div class="row">' + (ctl.opts.mode === "solo" || (ctl.allowTactical && ctl.allowTactical()) ? '<label class="switch grow"><input type="checkbox" id="pTactical"' + (settings.tactical ? " checked" : "") + '><span>Tactical hints</span></label>' : "") +
      '<label class="switch grow"><input type="checkbox" id="pTips"' + (settings.tips ? " checked" : "") + "><span>Learning tips</span></label></div>";
    h += "</div>";
    var root = $("#vPlay"), scroll = root.scrollTop;
    root.innerHTML = h;
    root.scrollTop = scroll;
    mountMini();
    var pt = $("#pTactical");
    if (pt) pt.onchange = function () { settings = S.saveSetting("tactical", this.checked); render(); };
    $("#pTips").onchange = function () { settings = S.saveSetting("tips", this.checked); };
  }

  function mountMini() {
    var box = $("#minimap");
    if (!box) return;
    if (!mini) mini = new FY.MapView(box, board, scene, { static: true, onTap: function (n) { setTab("map"); if (n) mv.focus(n, Math.max(1, mv.scale())); } });
    else box.appendChild(mini.svg);
    if (bg) mini.setBackground(bg.url, bg.painted);
    mini.resize();
    var p = myPiecePos();
    if (p) mini.focus(p, 0.85);
    mini.highlight(highlights());
    mini.setTokens(tokens());
  }

  function xPanel(who) {
    var t = ctl.s.xT, h = '<div class="xbox"><div class="chips">';
    ["taxi", "bus", "underground", "black"].forEach(function (k) { h += '<span class="chip">' + tkDot(k) + TK[k].n + " " + t[k] + "</span>"; });
    h += '<span class="chip">' + tkDot("double", "2") + "Double " + t.double + "</span></div>";
    if (who === "x" && ctl.s.xStep === 0) {
      var can = ctl.canDouble();
      if (!can) ui.armDouble = false;
      h += '<button class="btn' + (ui.armDouble ? " on" : "") + '" data-act="double"' + (can ? "" : " disabled") + ">" +
        (ui.armDouble ? "Double move armed: pick your first station" : "Use a double move (" + t.double + " left)") + "</button>";
    }
    return h + "</div>";
  }

  // Compact detective picker shown above the move cards.
  function pickerRow() {
    var s = ctl.s, mine = ctl.myDets, can = ctl.myTurnDets(), h = '<div class="chips" role="group" aria-label="Choose a detective">';
    mine.forEach(function (i) {
      var moved = s.moved[i], ok = can.indexOf(i) >= 0;
      h += '<button class="chip' + (i === ui.sel && ok ? " sel" : "") + (moved ? " done" : ok ? "" : " stuck") + '" data-det="' + i + '"' + (ok ? "" : " disabled") + ">" +
        '<span class="dot" style="background:' + DCOL[i % DCOL.length] + '">' + (i + 1) + "</span>" + s.dets[i].pos + (moved ? " ✓" : "") + "</button>";
    });
    return h + "</div>";
  }

  function detPanel(who) {
    var s = ctl.s, mine = ctl.myTurnDets(), h = '<div class="pieces">';
    s.dets.forEach(function (d, i) {
      var isMine = ctl.myDets.indexOf(i) >= 0, can = mine.indexOf(i) >= 0;
      var moved = s.pending === "det" || s.pending === "probe" ? s.moved[i] : false;
      var owner = ctl.ownerName ? ctl.ownerName(i) : "";
      h += '<button class="piece' + (i === ui.sel && can ? " sel" : "") + (moved ? " done" : "") + '" data-det="' + i + '"' + (can ? "" : " disabled") + ">" +
        '<span class="top"><span class="pdot" style="background:' + DCOL[i % DCOL.length] + '">' + (i + 1) + "</span>" + detName(i) + " · " + d.pos +
        (moved ? " ✓" : "") + (isMine || !owner ? "" : '<small style="color:var(--muted);font-weight:600">' + esc(owner) + "</small>") + "</span>" +
        '<span class="tks"><span>' + tkDot("taxi") + " " + d.t.taxi + "</span><span>" + tkDot("bus") + " " + d.t.bus + "</span><span>" + tkDot("underground") + " " + d.t.underground + "</span></span></button>";
    });
    return h + "</div>";
  }

  function cuesFor(g) {
    var s = ctl.s, who = myTurn(), out = [];
    var ferryOnly = g.tks.length === 1 && g.tks[0] === "black" && board.adj.ferry[ctl.secret ? ctl.secret.pos : 0] && board.adj.ferry[ctl.secret.pos].indexOf(g.to) >= 0;
    if (settings.tips) {
      if (ferryOnly) out.push({ c: "learn", t: "Ferry: only a black ticket can take it." });
      else if (g.tks.indexOf("black") >= 0 && who === "x") out.push({ c: "learn", t: "Black hides which transport you used." });
      if (who === "det") {
        var d = s.dets[selectedDet()];
        g.tks.forEach(function (tk) { if (d.t[tk] === 1) out.push({ c: "learn", t: "Uses your last " + TK[tk].n.toLowerCase() + " ticket." }); });
      }
      if (who === "x" && s.rules.reveals.indexOf(s.log.length + 1) >= 0) out.push({ c: "learn", t: "Reveal move: detectives will see this station." });
    }
    if (tacticalOn()) {
      if (who === "x") {
        var n = detectivesReach(g.to);
        out.push(n ? { c: "bad", t: n + " detective" + (n > 1 ? "s" : "") + " could reach this next turn." } : { c: "good", t: "No detective can reach this next turn." });
      } else if (who === "det") {
        if (s.P.indexOf(g.to) >= 0 && s.P.length <= 12) out.push({ c: "good", t: "Mr. X could be here (1 of " + s.P.length + ")." });
        var near = s.P.filter(function (p) { return board.distLand[g.to][p] <= 1; }).length;
        if (near) out.push({ c: "", t: "Next to " + near + " of his " + s.P.length + " possible stations." });
      }
    }
    return out;
  }
  function moveCard(g) {
    var cues = cuesFor(g), hot = cues.some(function (c) { return c.c === "good"; });
    var h = '<div class="mv' + (hot ? " hot" : "") + '"><div class="hd"><span class="num">' + g.to + '</span><span class="kind">' + KIND[board.kind[g.to]] + "</span>" +
      '<button class="see" data-see="' + g.to + '" aria-label="Show station ' + g.to + ' on the map">&#9678;</button></div><div class="tkb">';
    g.tks.forEach(function (tk) {
      var left = myTurn() === "x" ? ctl.s.xT[tk] : ctl.s.dets[selectedDet()].t[tk];
      h += '<button class="bg-' + tk + '" data-go="' + g.to + '" data-tk="' + tk + '" aria-label="' + TK[tk].n + " to " + g.to + '">' + TK[tk].n + " <small>(" + left + ")</small></button>";
    });
    h += "</div>";
    cues.forEach(function (c) { h += '<div class="cue ' + c.c + '">' + esc(c.t) + "</div>"; });
    return h + "</div>";
  }

  function go(to, tk) {
    var who = myTurn();
    if (!who) return;
    closeLayers();
    if (who === "x") {
      var dbl = ui.armDouble && ctl.s.xStep === 0;
      ui.armDouble = false;
      if (tk === "black") tip("black-use");
      if (dbl) tip("double-use");
      ctl.moveX({ to: to, tk: tk }, dbl);
    } else {
      var i = selectedDet();
      ctl.moveDet(i, { to: to, tk: tk });
    }
  }

  // ---------- map taps ----------
  function onTap(n) {
    if (!n || !ctl || ui.replay) return;
    var who = myTurn();
    if (who === "det") {
      var mine = ctl.myTurnDets();
      for (var k = 0; k < mine.length; k++) if (ctl.s.dets[mine[k]].pos === n) { ui.sel = mine[k]; render(); return; }
    }
    var g = groupByStation(currentOptions()).filter(function (x) { return x.to === n; })[0];
    if (g) {
      sheet('<h2 class="disp">Station ' + n + "</h2>" + moveCard(g) + '<button class="btn" data-act="close">Cancel</button>');
      return;
    }
    if (who) tip("unavailable");
    stationInfo(n);
  }
  function stationInfo(n) {
    var list = function (t) { return board.adj[t][n].slice().sort(function (a, b) { return a - b; }).join(", ") || "none"; };
    var h = '<h2 class="disp">Station ' + n + "</h2><p>" + KIND[board.kind[n]] + (scene.piers[n] ? " and ferry pier" : "") + ".</p><ul>" +
      "<li>" + tkDot("taxi") + " Taxi to " + list("taxi") + "</li>";
    if (board.adj.bus[n].length) h += "<li>" + tkDot("bus") + " Bus to " + list("bus") + "</li>";
    if (board.adj.underground[n].length) h += "<li>" + tkDot("underground") + " Underground to " + list("underground") + "</li>";
    if (board.adj.ferry[n].length) h += "<li>" + tkDot("ferry") + " Ferry to " + list("ferry") + " (Mr. X only, black ticket)</li>";
    h += "</ul>";
    if (myTurn()) h += '<p class="note">You can’t reach this station from where you are with your tickets.</p>';
    sheet(h + '<button class="btn" data-act="close">Close</button>');
  }

  // ---------- activity log ----------
  function renderLog() {
    if (!ctl) return;
    var s = ctl.s, route = (ctl.view === "x" || s.pending === "over") ? ctl.route() : null;
    var h = '<div class="lv"><div class="chips" role="group" aria-label="Filter">';
    var filters = [["all", "Everyone"], ["x", "Mr. X"]];
    s.dets.forEach(function (d, i) { filters.push(["d" + i, detName(i)]); });
    if (ctl.opts.mode !== "solo") filters.push(["sys", "Game"]);
    filters.forEach(function (f) { h += '<button class="chip' + (ui.filter === f[0] ? " sel" : "") + '" data-filter="' + f[0] + '">' + f[1] + "</button>"; });
    h += "</div>";
    var turns = {}, order = [];
    s.history.forEach(function (e) {
      var t = e.turn || 0;
      if (!turns[t]) { turns[t] = []; order.push(t); }
      turns[t].push(e);
    });
    order.slice().reverse().forEach(function (t) {
      var items = turns[t].filter(function (e) {
        if (ui.filter === "all") return true;
        if (ui.filter === "x") return e.k === "x" || e.k === "trapped" || e.k === "end";
        if (ui.filter === "sys") return e.k === "sys" || e.k === "end";
        return (e.k === "d" || e.k === "skip" || e.k === "caught") && "d" + e.i === ui.filter;
      });
      if (!items.length) return;
      var xs = turns[t].filter(function (e) { return e.k === "x"; }), rev = xs.some(function (e) { return e.rev != null; });
      var title = t === 0 ? "Start" : "Turn " + t + (xs.length ? " · move" + (xs.length > 1 ? "s " + xs[0].move + "–" + xs[xs.length - 1].move : " " + xs[0].move) : "");
      h += '<div class="turn' + (rev ? " rev" : "") + '"><h4>' + title + (rev ? " ★ reveal" : "") + "</h4><ul>";
      var skips = items.filter(function (e) { return e.k === "skip"; }).map(function (e) { return detName(e.i); });
      items.forEach(function (e) { if (e.k !== "skip") h += logItem(e, route); });
      if (skips.length) h += '<li class="sys">' + skips.join(", ") + (skips.length > 1 ? " could not move and were" : " could not move and was") + " skipped.</li>";
      h += "</ul></div>";
    });
    h += statsTable(route);
    h += "</div>";
    $("#vLog").innerHTML = h;
  }
  function logItem(e, route) {
    if (e.k === "start") return '<li class="sys">Detectives start at ' + e.dets.join(", ") + (route ? "; Mr. X starts at " + route[0] : "") + ".</li>";
    if (e.k === "x") {
      var pos = e.rev != null ? e.rev : route && route[e.move];
      return '<li><span class="who">Mr. X</span>' + tkDot(e.tk) + " " + TK[e.tk].n + (e.dbl ? " (double)" : "") +
        (pos ? ' <span class="ar">→</span> <b>' + pos + "</b>" : ' <span class="ar">→ ?</span>') + (e.rev != null ? " ★ seen" : "") + "</li>";
    }
    if (e.k === "d") return '<li><span class="who" style="color:' + DCOL[e.i % DCOL.length] + '">' + detName(e.i) + "</span>" + tkDot(e.tk) + " " + e.from + ' <span class="ar">→</span> ' + e.to + "</li>";
    if (e.k === "skip") return '<li class="sys">' + detName(e.i) + " could not move and was skipped.</li>";
    if (e.k === "caught") return '<li class="win">' + detName(e.i) + " caught Mr. X at " + e.pos + "!</li>";
    if (e.k === "trapped") return '<li class="win">Mr. X was trapped.</li>';
    if (e.k === "end") return '<li class="win">' + esc(e.reason) + "</li>";
    if (e.k === "sys") return '<li class="sys">' + esc(e.text) + "</li>";
    return "";
  }
  function statsTable(route) {
    var s = ctl.s, used = {}, near = {};
    s.history.forEach(function (e) {
      if (e.k === "d") { used[e.i] = used[e.i] || { taxi: 0, bus: 0, underground: 0 }; used[e.i][e.tk]++; }
      if (e.k === "x" && e.dist) e.dist.forEach(function (d, i) { (near[i] = near[i] || []).push(d); });
    });
    var xu = { taxi: 0, bus: 0, underground: 0, black: 0, double: 0 };
    s.history.forEach(function (e) { if (e.k === "x") { xu[e.tk]++; if (e.dbl) xu.double += 0.5; } });
    var h = '<div class="sect">Stats</div><table class="stats"><thead><tr><th>Player</th><th>' + tkDot("taxi") + "</th><th>" + tkDot("bus") + "</th><th>" + tkDot("underground") + "</th><th>Extra</th><th>Hops from X at reveals</th></tr></thead><tbody>";
    h += "<tr><td>Mr. X</td><td>" + xu.taxi + "</td><td>" + xu.bus + "</td><td>" + xu.underground + "</td><td>" + xu.black + " black, " + xu.double + " double</td><td>–</td></tr>";
    s.dets.forEach(function (d, i) {
      var u = used[i] || { taxi: 0, bus: 0, underground: 0 };
      h += '<tr><td style="color:' + DCOL[i % DCOL.length] + ';font-weight:700">' + detName(i) + "</td><td>" + u.taxi + "</td><td>" + u.bus + "</td><td>" + u.underground + "</td><td></td><td>" + ((near[i] || []).join(", ") || "–") + "</td></tr>";
    });
    return h + "</tbody></table>";
  }

  // ---------- replay ----------
  function startReplay() {
    var route = ctl.route();
    if (!route) { toast("Replay is not available yet", "Mr. X's route is only revealed when the game ends."); return; }
    var frames = [], s = R.init(board, ctl.s.events[0]), xi = 0;
    frames.push({ dets: s.dets.map(function (d) { return d.pos; }), x: route[0], label: "Start" });
    for (var k = 1; k < ctl.s.events.length; k++) {
      var ev = ctl.s.events[k];
      R.apply(board, s, ev);
      if (ev.t === "x") { xi++; frames.push({ dets: s.dets.map(function (d) { return d.pos; }), x: route[xi], label: "Move " + xi + ": Mr. X by " + TK[ev.tk].n.toLowerCase() + " to " + route[xi] }); }
      if (ev.t === "d") frames.push({ dets: s.dets.map(function (d) { return d.pos; }), x: route[xi], label: detName(ev.i) + " by " + TK[ev.tk].n.toLowerCase() + " to " + ev.to });
    }
    ui.replay = { frames: frames, k: 0, label: frames[0].label };
    closeLayers();
    setTab("map");
    var bar = $("#replayBar");
    bar.classList.remove("hidden");
    bar.innerHTML = '<button class="btn sm" data-rp="-1" aria-label="Previous step">◀</button><input type="range" min="0" max="' + (frames.length - 1) + '" value="0" aria-label="Replay position"><button class="btn sm" data-rp="1" aria-label="Next step">▶</button><span class="rl"></span><button class="btn sm" data-rp="x">Done</button>';
    var input = bar.querySelector("input");
    function at(k) {
      ui.replay.k = Math.max(0, Math.min(frames.length - 1, k));
      ui.replay.label = frames[ui.replay.k].label;
      input.value = ui.replay.k;
      bar.querySelector(".rl").textContent = (ui.replay.k + 1) + "/" + frames.length;
      render();
      $("#gStatus").textContent = ui.replay.label;
    }
    input.oninput = function () { at(+input.value); };
    bar.onclick = function (e) {
      var b = e.target.closest("[data-rp]");
      if (!b) return;
      var v = b.getAttribute("data-rp");
      if (v === "x") { ui.replay = null; bar.classList.add("hidden"); render(); return; }
      at(ui.replay.k + (+v));
    };
    mv.fit();
    at(0);
  }

  // ---------- end of game ----------
  function showEnd() {
    var s = ctl.s, route = ctl.route();
    var youWin = ctl.view === "gm" ? null : (s.winner === "x") === (ctl.view === "x");
    overlay('<h2 class="disp">' + (youWin === null ? (s.winner === "x" ? "Mr. X wins" : "The detectives win") : youWin ? "You win!" : "You lose") + "</h2><p>" + esc(s.reason) + "</p>" +
      (route ? '<p class="note">Mr. X\'s route: ' + route.join(" → ") + "</p>" : "") +
      '<div class="row"><button class="btn pri grow" data-act="rematch">Rematch</button><button class="btn grow" data-act="replay">Replay</button></div>' +
      '<div class="row"><button class="btn grow" data-act="log">Activity log</button><button class="btn grow" data-act="menu">Menu</button></div>');
  }
  function rematch() {
    if (ctl.rematch) { closeLayers(); ctl.rematch(); return; }
    var c = new FY.Controller(board, ctl.opts);
    c.newGame();
    enterGame(c);
  }

  // ---------- tips ----------
  var TIPS = {
    "welcome-det": ["Hunting Mr. X", "Each detective moves once per turn. Pick a move card (or tap a glowing station on the map). Land on Mr. X to catch him."],
    "welcome-x": ["You are Mr. X", "Move secretly; the detectives only see which ticket you used. Stay away from them and keep your options open."],
    "reveal": ["Reveal move", "After moves " + C.rules.reveals.join(", ") + " Mr. X must show where he is. Use it to close in."],
    "black-seen": ["Black ticket", "Mr. X used a black ticket: it hides which transport he took, and it is the only way onto the ferry."],
    "black-use": ["Black ticket", "Your black ticket hides your transport and is the only way to ride the ferry. You have one per detective."],
    "double-seen": ["Double move", "Mr. X moved twice in a row. Both moves count towards his " + C.rules.rounds + "."],
    "double-use": ["Double move", "Pick your second station next. Both moves use a ticket and fill two places in your travel log."],
    "handover": ["Tickets change hands", "Every ticket a detective spends goes to Mr. X, so he never runs out."],
    "stuck": ["Stuck detective", "A detective with no ticket for any route from its station misses its turn. If no detective can move, Mr. X wins."],
    "unavailable": ["Not reachable", "Each ticket follows its own lines: taxi (yellow streets), bus (teal lanes) and underground (red dashes)."]
  };
  function tip(id) {
    if (!settings.tips || S.tipSeen(id) || !TIPS[id]) return;
    if (ui.toastQ.indexOf(id) >= 0) return;
    ui.toastQ.push(id);
    if (ui.toastQ.length === 1) showToast();
  }
  function showToast() {
    var id = ui.toastQ[0];
    if (!id) return;
    toast(TIPS[id][0], TIPS[id][1], function () { S.markTip(id); ui.toastQ.shift(); setTimeout(showToast, 250); });
  }
  function toast(title, body, done) {
    var t = $("#toast");
    t.innerHTML = '<div class="tt"><b>' + esc(title) + "</b>" + esc(body) + '</div><button type="button">Got it</button>';
    t.classList.remove("hidden");
    t.querySelector("button").onclick = function () { t.classList.add("hidden"); if (done) done(); };
  }

  // ---------- dialogs ----------
  function showHelp() {
    var r = C.rules;
    overlay('<h2 class="disp">How to play</h2><ul>' +
      "<li><b>Mr. X</b> hides somewhere in London. Up to five <b>detectives</b> hunt him. A detective landing on his station catches him.</li>" +
      "<li>Every move costs a ticket. " + tkDot("taxi") + " <b>Taxi</b> follows the streets, " + tkDot("bus") + " <b>bus</b> the teal lanes between bus stops, " + tkDot("underground") + " <b>underground</b> the red dashed lines.</li>" +
      "<li>Detectives see which ticket Mr. X used but not where he went. He must show himself after moves " + r.reveals.join(", ") + ".</li>" +
      "<li>Mr. X starts with " + r.mrxTickets.taxi + " taxi, " + r.mrxTickets.bus + " bus and " + r.mrxTickets.underground + " underground tickets, one <b>black</b> ticket per detective (any transport, hidden, and the only way onto the " + tkDot("ferry") + " ferry) and " + r.mrxDoubles + " <b>double moves</b>. Every ticket a detective spends goes to him.</li>" +
      "<li>Each detective has " + r.detectiveTickets.taxi + " taxi, " + r.detectiveTickets.bus + " bus and " + r.detectiveTickets.underground + " underground tickets. Detectives can't share a station.</li>" +
      "<li><b>Mr. X wins</b> by staying free for " + r.rounds + " moves, or if no detective can move. <b>Detectives win</b> by catching him or trapping him so he can't move.</li>" +
      "<li>Use <b>Play</b> to pick moves from cards, <b>Map</b> to look around (pinch or + / − to zoom, drag to pan), and <b>Log</b> for everything that happened.</li></ul>" +
      '<div class="leg"><span><i style="background:var(--taxi)"></i>Taxi</span><span><i style="background:var(--bus)"></i>Bus</span><span><i style="background:var(--underground)"></i>Underground</span><span><i style="background:var(--ferry)"></i>Ferry</span></div>' +
      '<button class="btn pri" data-act="close">Got it</button>');
  }
  function showAbout() {
    overlay('<h2 class="disp">About Fog Yard</h2>' +
      "<p>Station network derived from tim-koehler/ScotlandYard (Apache-2.0). Fog Yard is an unofficial fan project and is not affiliated with Ravensburger.</p>" +
      "<p>Map data © OpenStreetMap contributors, available under the Open Database License. The illustrated board, station layout and landmark icons are original.</p>" +
      '<p class="note">Online play connects players directly using PeerJS. No game data is stored on a server.</p>' +
      '<button class="btn pri" data-act="close">Close</button>');
  }
  function showSettings() {
    overlay('<h2 class="disp">Settings</h2>' +
      '<label class="field"><span>Theme</span><div class="seg" id="oTheme"></div></label>' +
      '<label class="switch"><input type="checkbox" id="oTips"' + (settings.tips ? " checked" : "") + "><span>Learning tips</span></label>" +
      '<label class="switch"><input type="checkbox" id="oTactical"' + (settings.tactical ? " checked" : "") + "><span>Tactical hints (solo, or when the game master allows them)</span></label>" +
      '<label class="switch"><input type="checkbox" id="oVibrate"' + (settings.vibrate ? " checked" : "") + "><span>Vibrate when it's my turn</span></label>" +
      '<div class="row"><button class="btn grow" id="oResetTips">Show all tips again</button><button class="btn pri grow" data-act="close">Done</button></div>', function (card) {
      seg(card.querySelector("#oTheme"), ["auto", "light", "dark"], settings.theme, ["Auto", "Light", "Dark"], function (v) { settings = S.saveSetting("theme", v); applyTheme(); });
      card.querySelector("#oTips").onchange = function () { settings = S.saveSetting("tips", this.checked); render(); };
      card.querySelector("#oTactical").onchange = function () { settings = S.saveSetting("tactical", this.checked); render(); };
      card.querySelector("#oVibrate").onchange = function () { settings = S.saveSetting("vibrate", this.checked); };
      card.querySelector("#oResetTips").onclick = function () { S.resetTips(); this.textContent = "Tips will show again"; };
    });
  }
  function gameMenu() {
    var solo = ctl.opts.mode === "solo";
    overlay('<h2 class="disp">Game menu</h2>' +
      '<button class="btn" data-act="close">Back to the game</button>' +
      '<button class="btn" data-act="log">Activity log</button>' +
      '<button class="btn" data-act="settings">Settings</button>' +
      '<button class="btn" data-act="help">How to play</button>' +
      (ctl.extraMenu ? ctl.extraMenu() : "") +
      '<button class="btn pri" data-act="menu">Leave game</button>' +
      '<p class="note">' + (solo ? "Your solo game is saved on this device; continue it from the main menu." : ctl.leaveNote ? ctl.leaveNote() : "") + "</p>");
  }
  function toMenu() {
    if (ctl) { if (ctl.leave) ctl.leave(); ctl.destroy(); ctl = null; }
    ui.replay = null;
    $("#toast").classList.add("hidden");
    refreshMenu();
    show("menu");
  }

  // ---------- global click handling ----------
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-act],[data-go],[data-see],[data-det],[data-filter]");
    if (!t) return;
    if (t.hasAttribute("data-go")) return go(+t.getAttribute("data-go"), t.getAttribute("data-tk"));
    if (t.hasAttribute("data-see")) {
      var n = +t.getAttribute("data-see");
      closeLayers();
      setTab("map");
      mv.focus(n, Math.max(1, mv.scale()));
      var who = myTurn(), from = who === "x" ? ctl.secret.pos : who === "det" ? ctl.s.dets[selectedDet()].pos : null;
      if (from) mv.showRoutes(currentOptions().filter(function (o) { return o.to === n; }).map(function (o) { return { a: from, b: n, t: o.tk === "black" ? (board.adj.ferry[from].indexOf(n) >= 0 ? "ferry" : ["taxi", "bus", "underground"].filter(function (k) { return board.adj[k][from].indexOf(n) >= 0; })[0]) : o.tk }; }));
      setTimeout(function () { mv.showRoutes([]); }, 2500);
      return;
    }
    if (t.hasAttribute("data-det")) { ui.sel = +t.getAttribute("data-det"); render(); focusMine(false); return; }
    if (t.hasAttribute("data-filter")) { ui.filter = t.getAttribute("data-filter"); renderLog(); return; }
    var a = t.getAttribute("data-act");
    if (a === "close") closeLayers();
    else if (a === "double") { ui.armDouble = !ui.armDouble; render(); }
    else if (a === "rematch") rematch();
    else if (a === "replay") startReplay();
    else if (a === "log") { closeLayers(); setTab("log"); }
    else if (a === "menu") toMenu();
    else if (a === "settings") showSettings();
    else if (a === "help") showHelp();
    else if (ctl && ctl.onAction) ctl.onAction(a, t);
  });
  ["#sheet", "#overlay"].forEach(function (q) {
    $(q).addEventListener("click", function (e) { if (e.target === this && !(ctl && ctl.s && ctl.s.pending === "over" && q === "#overlay" && !ui.endShown)) this.classList.add("hidden"); });
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeLayers(); });
  window.addEventListener("resize", function () { if (ctl) { if (wide() && ui.tab === "map") setTab("play"); render(); } });

  // ---------- boot ----------
  function boot() {
    applyTheme();
    board = FY.Board.build(window.FY_DATA);
    scene = FY.Scene.compose(board);
    $("#mSoloDet").onclick = function () { openSetup("det"); };
    $("#mSoloX").onclick = function () { openSetup("x"); };
    $("#mContinue").onclick = continueSolo;
    $("#mOnline").onclick = function () { if (FY.Net) FY.Net.open(); else toast("Online play", "Online play is not available in this build."); };
    $("#mHelp").onclick = showHelp;
    $("#mSettings").onclick = showSettings;
    $("#mAbout").onclick = showAbout;
    $("#sBack").onclick = function () { show("menu"); };
    $("#sStart").onclick = startSolo;
    $("#gMenu").onclick = gameMenu;
    $("#gHelp").onclick = showHelp;
    $("#tabs").onclick = function (e) { var b = e.target.closest("[data-tab]"); if (b) setTab(b.getAttribute("data-tab")); };
    refreshMenu();
    $("#painting").classList.remove("hidden");
    FY.Terrain.background(scene).then(function (r) {
      bg = r;
      $("#painting").classList.add("hidden");
      if (mv) mv.setBackground(r.url, r.painted);
      if (mini) mini.setBackground(r.url, r.painted);
    });
    FY.UI.ready = true;
  }

  FY.UI = {
    enterGame: enterGame, render: render, toast: toast, overlay: overlay, closeLayers: closeLayers, show: show,
    toMenu: toMenu, esc: esc, get board() { return board; }, get controller() { return ctl; }, DCOL: DCOL
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window.FY = window.FY || {});
