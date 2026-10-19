/* Fog Yard online play: peer-to-peer (PeerJS), with the game master's device as the hub.

   The game is one shared log of entries {n, ev, by, sig}. The game master's device orders the
   log and relays it; EVERY device re-verifies each entry (author, signature, rules) and replays
   it through the same rules engine, so nobody, the game master included, can forge or alter a
   move unnoticed.

   Referee modes
     verified: Mr. X's position lives only on Mr. X's device. His moves carry SHA-256 commitments;
               at the end he reveals route + salts and every device audits the whole game.
     trusted:  the game master's device holds Mr. X's position (and can see it); Mr. X's device
               sends move requests. Simpler, and the game master can take over if Mr. X leaves. */
(function (FY) {
  "use strict";
  var R = FY.Rules, S = FY.Store, C = FY.CONFIG;
  var $ = function (q) { return document.querySelector(q); };

  // ------------------------------------------------------------------ crypto
  var subtle = window.crypto && window.crypto.subtle;
  var enc = new TextEncoder();
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); }
  function b64(buf) { return btoa(String.fromCharCode.apply(null, new Uint8Array(buf))); }
  function unb64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function sha256(str) { return subtle.digest("SHA-256", enc.encode(str)).then(hex); }
  function randomHex(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return hex(a); }
  var ALG = { name: "ECDSA", namedCurve: "P-256" }, SIG = { name: "ECDSA", hash: "SHA-256" };
  function genKeys() {
    return subtle.generateKey(ALG, true, ["sign", "verify"]).then(function (k) {
      return Promise.all([subtle.exportKey("jwk", k.publicKey), subtle.exportKey("jwk", k.privateKey)]).then(function (j) {
        return { pub: { kty: j[0].kty, crv: j[0].crv, x: j[0].x, y: j[0].y }, priv: j[1], key: k.privateKey };
      });
    });
  }
  function loadKeys(saved) {
    return subtle.importKey("jwk", saved.priv, ALG, false, ["sign"]).then(function (key) { return { pub: saved.pub, priv: saved.priv, key: key }; });
  }
  var pubCache = {};
  function pubKey(jwk) {
    var id = jwk.x + jwk.y;
    if (!pubCache[id]) pubCache[id] = subtle.importKey("jwk", jwk, ALG, false, ["verify"]);
    return pubCache[id];
  }
  function sign(keys, str) { return subtle.sign(SIG, keys.key, enc.encode(str)).then(b64); }
  function verifySig(jwk, str, sig) {
    if (!jwk || !sig) return Promise.resolve(false);
    return pubKey(jwk).then(function (k) { return subtle.verify(SIG, k, unb64(sig), enc.encode(str)); }).catch(function () { return false; });
  }
  // Short, speakable key fingerprint players can compare out loud.
  function fingerprint(jwk) {
    return sha256(jwk.x + "." + jwk.y).then(function (h) {
      var A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789", out = "";
      for (var i = 0; i < 4; i++) out += A[parseInt(h.substr(i * 2, 2), 16) % A.length];
      return out;
    });
  }
  function commitStr(code, k, pos, salt) { return code + "|" + k + "|" + pos + "|" + salt; }

  // ------------------------------------------------------------------ transports
  // Both expose: listen(id, onConn, onReady, onError) -> {close}; connect(id, h) -> conn.
  // A conn has send(obj), close(), and calls h.open / h.data(obj) / h.close.
  var Transports = {};
  Transports.peer = {
    available: function () { return typeof window.Peer !== "undefined"; },
    // Extra TURN/STUN servers are added to PeerJS's own defaults (its STUN plus its free,
    // best-effort TURN relays), never replacing them.
    options: function () {
      if (!C.net.iceServers || !C.net.iceServers.length) return {};
      var pj = window.peerjs && window.peerjs.util && window.peerjs.util.defaultConfig;
      var base = pj && pj.iceServers ? pj.iceServers : [{ urls: "stun:stun.l.google.com:19302" }];
      return { config: { iceServers: base.concat(C.net.iceServers) } };
    },
    wrap: function (dc, h) {
      var conn = { open: false, send: function (o) { try { if (dc.open) dc.send(o); } catch (e) {} }, close: function () { try { dc.close(); } catch (e) {} } };
      dc.on("open", function () { conn.open = true; h.open && h.open(); });
      dc.on("data", function (d) { h.data && h.data(d); });
      dc.on("close", function () { conn.open = false; h.close && h.close(); });
      dc.on("error", function () { conn.open = false; h.close && h.close(); });
      return conn;
    },
    listen: function (id, onConn, onReady, onError) {
      var self = this, peer = new window.Peer(id, this.options()), closed = false;
      peer.on("open", function () { onReady(); });
      peer.on("connection", function (dc) {
        var h = {}, conn = self.wrap(dc, h);
        onConn(conn, h);
        if (dc.open) { conn.open = true; h.open && h.open(); }
      });
      peer.on("disconnected", function () { if (!closed) setTimeout(function () { try { peer.reconnect(); } catch (e) {} }, 1500); });
      peer.on("error", function (e) { onError(e.type || "error"); });
      return { close: function () { closed = true; try { peer.destroy(); } catch (e) {} } };
    },
    connect: function (id, h) {
      var self = this, peer = new window.Peer(this.options()), conn = { open: false, send: function () {}, close: function () { try { peer.destroy(); } catch (e) {} } };
      peer.on("open", function () {
        var inner = self.wrap(peer.connect(id, { reliable: true }), {
          open: function () { conn.open = true; h.open && h.open(); },
          data: function (d) { h.data && h.data(d); },
          close: function () { conn.open = false; h.close && h.close(); }
        });
        conn.send = inner.send;
      });
      peer.on("error", function (e) { conn.open = false; h.error ? h.error(e.type || "error") : h.close && h.close(); });
      return conn;
    }
  };
  // Same-browser transport over BroadcastChannel, used by the automated tests (?transport=local).
  Transports.local = {
    available: function () { return typeof BroadcastChannel !== "undefined"; },
    bus: function () { return this._bus || (this._bus = new BroadcastChannel("fogyard-local")); },
    listen: function (id, onConn, onReady) {
      var bus = this.bus(), conns = {};
      function onMsg(e) {
        var m = e.data;
        if (!m || m.to !== id) return;
        if (m.k === "connect") {
          var h = {}, cid = m.cid, conn = { open: true, send: function (o) { bus.postMessage({ to: cid, k: "data", d: o }); }, close: function () { bus.postMessage({ to: cid, k: "close" }); delete conns[cid]; } };
          conns[cid] = { conn: conn, h: h };
          onConn(conn, h);
          bus.postMessage({ to: cid, k: "accept" });
          h.open && h.open();
        } else if (conns[m.cid]) {
          if (m.k === "data") conns[m.cid].h.data && conns[m.cid].h.data(m.d);
          if (m.k === "close") { conns[m.cid].conn.open = false; conns[m.cid].h.close && conns[m.cid].h.close(); delete conns[m.cid]; }
        }
      }
      bus.addEventListener("message", onMsg);
      setTimeout(onReady, 30);
      return { close: function () { bus.removeEventListener("message", onMsg); Object.keys(conns).forEach(function (c) { bus.postMessage({ to: c, k: "close" }); }); } };
    },
    connect: function (id, h) {
      var bus = this.bus(), cid = "c" + Math.random().toString(36).slice(2), conn = { open: false };
      function onMsg(e) {
        var m = e.data;
        if (!m || m.to !== cid) return;
        if (m.k === "accept") { conn.open = true; h.open && h.open(); }
        if (m.k === "data") h.data && h.data(m.d);
        if (m.k === "close") { conn.open = false; bus.removeEventListener("message", onMsg); h.close && h.close(); }
      }
      bus.addEventListener("message", onMsg);
      conn.send = function (o) { bus.postMessage({ to: id, cid: cid, k: "data", d: o }); };
      conn.close = function () { bus.postMessage({ to: id, cid: cid, k: "close" }); bus.removeEventListener("message", onMsg); };
      bus.postMessage({ to: id, cid: cid, k: "connect" });
      setTimeout(function () { if (!conn.open) { bus.removeEventListener("message", onMsg); h.error ? h.error("peer-unavailable") : h.close && h.close(); } }, 1500);
      window.addEventListener("pagehide", function () { if (conn.open) conn.close(); });
      return conn;
    }
  };
  function transport() {
    var q = new URLSearchParams(location.search).get("transport");
    return Transports[q === "local" ? "local" : "peer"];
  }

  // ------------------------------------------------------------------ the shared log
  function ctxOf(s) { return s ? "t" + s.turn + "m" + s.log.length + "p" + s.pending + "x" + s.xStep : "pre"; }
  function payload(code, ctx, ev, by) { return [code, ctx, JSON.stringify(ev), by].join("|"); }
  var RULE_EVENTS = { start: 1, x: 1, d: 1, probe: 1, trapped: 1 };

  // Who may author an entry, given the current seats and referee mode.
  function authorFor(sess, ev) {
    var seats = sess.seats || {}, xAuthor = sess.settings.referee === "trusted" ? "host" : seats.mrx;
    if (ev.t === "setup" || ev.t === "start" || ev.t === "seat" || ev.t === "sys" || ev.t === "rename") return "host";
    if (ev.t === "d") return seats.pawns && seats.pawns[ev.i];
    return xAuthor; // commit0, x, probe, trapped, route
  }

  // Applies an already-verified entry to the session's state.
  function applyEntry(sess, entry) {
    var ev = entry.ev, board = FY.UI.board;
    if (ev.t === "setup") {
      sess.seats = JSON.parse(JSON.stringify(ev.seats));
      sess.settings = ev.settings;
      sess.roster = ev.players;
      sess.state = null; sess.commit0 = null; sess.routeEntry = null; sess.audit = null;
    } else if (ev.t === "start") {
      sess.state = R.init(board, ev);
    } else if (RULE_EVENTS[ev.t]) {
      R.apply(board, sess.state, ev);
    } else if (ev.t === "commit0") {
      sess.commit0 = ev.c;
    } else if (ev.t === "seat") {
      if (ev.pawn === "mrx") sess.seats.mrx = ev.to; else sess.seats.pawns[ev.pawn] = ev.to;
      note(sess, (ev.pawn === "mrx" ? "Mr. X" : "D" + (ev.pawn + 1)) + " is now played by " + (ev.to === sess.myId ? "you" : labelOf(sess, ev.to)) + ".");
    } else if (ev.t === "route") {
      sess.routeEntry = ev;
    } else if (ev.t === "rename") {
      var r = sess.roster && sess.roster[ev.id];
      if (r) { var was = labelOf(sess, ev.id); r.name = ev.name; r.alias = ev.alias; note(sess, was + " is now " + labelOf(sess, ev.id) + "."); }
    } else if (ev.t === "sys") note(sess, ev.text);
    sess.entries.push(entry);
  }
  function note(sess, text) { if (sess.state) sess.state.history.push({ k: "sys", text: text, turn: sess.state.turn }); else (sess.pendingNotes = sess.pendingNotes || []).push(text); }
  // "Moriarty (Flora)" when a player set an alias, otherwise just "Flora".
  function labelOf(sess, id) {
    var p = (sess.roster || sess.players || {})[id] || (sess.lobby && sess.lobby.players[id]);
    if (!p) return "someone";
    return p.alias ? p.alias + " (" + p.name + ")" : p.name;
  }
  function nameOf(sess, id) { var p = (sess.roster || sess.players || {})[id]; return id === sess.myId ? "you" : p ? p.name : id === "host" ? "the game master" : "someone"; }

  // Full check of one entry against the session: author, signature (when keys exist) and rules.
  function verifyEntry(sess, entry) {
    var ev = entry.ev;
    if (!ev || typeof ev.t !== "string") return Promise.resolve("malformed entry");
    if (ev.t !== "setup" && !sess.seats) return Promise.resolve("entry before setup");
    var want = ev.t === "setup" ? "host" : authorFor(sess, ev);
    if (entry.by !== want) return Promise.resolve((ev.t === "d" ? "D" + (ev.i + 1) + " was moved by someone who doesn't control it" : ev.t + " sent by the wrong player"));
    if (RULE_EVENTS[ev.t] && ev.t !== "start") {
      if (!sess.state) return Promise.resolve("move before the game started");
      if ((ev.t === "x" || ev.t === "trapped") && !sess.commit0) return Promise.resolve("Mr. X moved before committing to a start");
      if (ev.t === "x" && sess.settings.referee && !ev.c) return Promise.resolve("Mr. X's move has no commitment");
      try { R.apply(FY.UI.board, R.clone(sess.state), ev); } catch (e) { return Promise.resolve(e.message); }
    }
    if (ev.t === "start" && sess.state) return Promise.resolve("game already started");
    if (ev.t === "commit0" && sess.commit0) return Promise.resolve("start already committed");
    if (ev.t === "route" && (!sess.state || sess.state.pending !== "over")) return Promise.resolve("route revealed before the end");
    var keys = ev.t === "setup" ? ev.players : sess.roster;
    if (!subtle || !keys || !keys[entry.by] || !keys[entry.by].key) return Promise.resolve(subtle ? "unknown signing key" : null);
    return verifySig(keys[entry.by].key, payload(sess.code, ctxOf(sess.state && RULE_EVENTS[ev.t] && ev.t !== "start" ? sess.state : null) + (RULE_EVENTS[ev.t] ? "" : ":" + ev.t), ev, entry.by), entry.sig)
      .then(function (ok) { return ok ? null : "bad signature from " + nameOf(sess, entry.by); });
  }
  function signEntry(sess, ev) {
    var ctx = ctxOf(sess.state && RULE_EVENTS[ev.t] && ev.t !== "start" ? sess.state : null) + (RULE_EVENTS[ev.t] ? "" : ":" + ev.t);
    var entry = { ev: ev, by: sess.myId };
    if (!subtle || !sess.keys) return Promise.resolve(entry);
    return sign(sess.keys, payload(sess.code, ctx, ev, sess.myId)).then(function (sig) { entry.sig = sig; return entry; });
  }

  // End-of-game audit: replays the public log against Mr. X's revealed route and salts.
  function audit(sess) {
    var re = sess.routeEntry, board = FY.UI.board, code = sess.code;
    if (!re) return Promise.resolve(null);
    var route = re.route, salts = re.salts, problems = [], checks = [];
    var rules = sess.entries.filter(function (e) { return RULE_EVENTS[e.ev.t]; }).map(function (e) { return e.ev; });
    var s = R.init(board, rules[0]), pos = route[0], k = 0;
    if (board.starts.mrx.indexOf(pos) < 0 || rules[0].dets.indexOf(pos) >= 0) problems.push("Mr. X's start " + pos + " is not a valid start card");
    checks.push(sha256(commitStr(code, 0, pos, salts[0])).then(function (h) { if (h !== sess.commit0) problems.push("Mr. X's start doesn't match his commitment"); }));
    rules.slice(1).forEach(function (ev) {
      if (ev.t === "x") {
        k++;
        var to = route[k], legal = R.xOptions(board, s, pos).some(function (o) { return o.to === to && o.tk === ev.tk; });
        if (!legal) problems.push("move " + k + " (" + ev.tk + " from " + pos + " to " + to + ") was not legal");
        if (ev.rev != null && ev.rev !== to) problems.push("move " + k + " was revealed as " + ev.rev + " but was really " + to);
        (function (kk, toPos) {
          checks.push(sha256(commitStr(code, kk, toPos, salts[kk])).then(function (h) { if (h !== ev.c) problems.push("move " + kk + " doesn't match its commitment"); }));
        })(k, to);
        pos = to;
      } else if (ev.t === "probe") {
        var truth = s.dets[ev.i].pos === pos;
        if (truth !== !!ev.caught) problems.push("after D" + (ev.i + 1) + "'s move Mr. X answered " + (ev.caught ? "caught" : "not caught") + " but was at " + pos);
      } else if (ev.t === "trapped") {
        if (R.xOptions(board, s, pos).length) problems.push("Mr. X claimed to be trapped but could still move");
      }
      R.apply(board, s, ev);
    });
    if (k !== route.length - 1) problems.push("the revealed route has the wrong length");
    return Promise.all(checks).then(function () { return { ok: !problems.length, problems: problems }; });
  }

  // ------------------------------------------------------------------ online controller
  function NetController(sess) {
    FY.Controller.call(this, FY.UI.board, { mode: "online" });
    this.sess = sess;
    this.s = sess.state;
  }
  NetController.prototype = Object.create(FY.Controller.prototype);
  NetController.prototype.refresh = function () {
    var sess = this.sess, seats = sess.seats;
    this.s = sess.state;
    this.humanX = seats.mrx === sess.myId;
    this.myDets = [];
    for (var i = 0; i < (seats.pawns || []).length; i++) if (seats.pawns[i] === sess.myId) this.myDets.push(i);
    this.aiDets = [];
    this.isGM = sess.myId === "host";
    var seesX = this.humanX || (sess.settings.referee === "trusted" && this.isGM);
    this.spectator = !this.humanX && !this.myDets.length;
    this.view = seesX ? "x" : "det";
    this.secret = sess.secret || null;
    this.offline = sess.offline;
    this.verdict = sess.audit && !sess.audit.ok ? sess.audit : null;
  };
  NetController.prototype.ready = function () { return !!(this.s && this.sess.commit0); };
  // While a move is on its way, the same state can't send another (no double taps).
  NetController.prototype.locked = function () { return this.sess.lock != null && this.sess.lock === this.s.events.length; };
  NetController.prototype.isMyXTurn = function () { return this.humanX && this.ready() && this.s.pending === "x" && !this.sess.offline && !!this.secret && !this.locked(); };
  NetController.prototype.myTurnDets = function () {
    if (!this.s || this.sess.offline || this.locked()) return [];
    return FY.Controller.prototype.myTurnDets.call(this);
  };
  NetController.prototype.moveX = function (opt, dbl) {
    if (!this.isMyXTurn()) return false;
    var sess = this.sess;
    sess.lock = this.s.events.length;
    if (sess.settings.referee === "trusted" && sess.role === "guest") sess.send({ t: "xreq", opt: opt, dbl: !!dbl });
    else holderMove(sess, opt, dbl);
    this.emit({ t: "sent" });
    return true;
  };
  NetController.prototype.moveDet = function (i, opt) {
    if (this.myTurnDets().indexOf(i) < 0) return false;
    this.sess.lock = this.s.events.length;
    this.sess.author({ t: "d", i: i, to: opt.to, tk: opt.tk });
    this.emit({ t: "sent" });
    return true;
  };
  NetController.prototype.kick = function () {};
  NetController.prototype.save = function () {};
  NetController.prototype.route = function () {
    if (this.sess.routeEntry) return this.sess.routeEntry.route;
    return this.secret ? [this.secret.start].concat(this.secret.route) : null;
  };
  NetController.prototype.detOwnerLabel = function (i) {
    var id = this.sess.seats.pawns[i];
    if (id === this.sess.myId) return "you";
    return labelOf(this.sess, id);
  };
  NetController.prototype.xShort = function () {
    var p = (this.sess.roster || {})[this.sess.seats.mrx];
    return (p && p.alias) || "Mr. X";
  };
  NetController.prototype.xLabel = function () {
    var id = this.sess.seats.mrx, p = (this.sess.roster || {})[id];
    return this.xShort() + " (" + (id === this.sess.myId ? "you" : p ? p.name : "?") + ")";
  };
  NetController.prototype.myName = function () { var p = (this.sess.roster || {})[this.sess.myId]; return p ? p.name : ""; };
  NetController.prototype.allowTactical = function () { return !!this.sess.settings.tactical; };
  NetController.prototype.leaveNote = function () {
    return this.sess.role === "host" ? "The game stays saved on this device; resume hosting from the online menu." : "You can rejoin with the same code while the game master's game is open.";
  };
  NetController.prototype.extraMenu = function () {
    return '<button class="btn" data-act="profile">Change my name or alias</button>' + (this.isGM ? '<button class="btn" data-act="seats">Players and seats</button>' : "") + '<button class="btn" data-act="keys">Check fingerprints</button>';
  };
  NetController.prototype.onAction = function (a) {
    if (a === "seats") seatsDialog(this.sess);
    if (a === "keys") keysDialog(this.sess);
    if (a === "profile") profileDialog(this.sess);
  };
  NetController.prototype.rematch = function () {
    if (this.sess.role !== "host") { FY.UI.toast("Rematch", "Ask the game master to start a rematch."); return; }
    hostStartGame(this.sess);
  };
  NetController.prototype.leave = function () { this.sess.close(); };

  // The device that holds Mr. X's secret builds his move, commits to it and publishes it.
  function holderMove(sess, opt, dbl) {
    var s = sess.state, secret = sess.secret;
    var probe = R.clone(secret);
    var ev = R.xMove(FY.UI.board, R.clone(s), probe, opt, dbl);
    var k = s.log.length + 1, salt = randomHex(16);
    sha256(commitStr(sess.code, k, opt.to, salt)).then(function (c) {
      ev.c = c;
      secret.pos = probe.pos; secret.route = probe.route; secret.salts[k] = salt;
      saveSecret(sess);
      sess.author(ev);
    });
  }
  function saveSecret(sess) { S.set("xsecret." + sess.code, sess.secret); if (sess.role === "host") persistHost(sess); }

  // Automatic steps for the secret holder: commit to a start, answer capture checks, report a
  // trap, and reveal the route at the end.
  function holderAuto(sess) {
    var s = sess.state, xAuthor = authorFor(sess, { t: "x" });
    if (xAuthor !== sess.myId || sess.busyAuto) return;
    var board = FY.UI.board;
    // One automatic step at a time; when it lands, look again (the next step may already be due).
    function run(p) {
      sess.busyAuto = true;
      var again = function () { sess.busyAuto = false; setTimeout(function () { if (!sess.closed) holderAuto(sess); }, 0); };
      p.then(again, again);
    }
    if (s && !sess.commit0 && s.pending !== "over") {
      if (!sess.secret || sess.secret.startFor !== sess.gameId) {
        var pool = board.starts.mrx.filter(function (p) { return s.dets.every(function (d) { return d.pos !== p; }); });
        var start = pool[Math.floor(Math.random() * pool.length)];
        sess.secret = { pos: start, start: start, route: [], salts: [randomHex(16)], startFor: sess.gameId };
        saveSecret(sess);
      }
      return run(sha256(commitStr(sess.code, 0, sess.secret.start, sess.secret.salts[0])).then(function (c) { return sess.author({ t: "commit0", c: c }); }));
    }
    if (!s || !sess.secret) return;
    if (s.pending === "probe") return run(sess.author(R.probeFor(s, sess.secret)));
    if (s.pending === "x" && s.xStep === 0 && sess.commit0 && R.isTrapped(board, s, sess.secret)) return run(sess.author({ t: "trapped" }));
    if (s.pending === "over" && !sess.routeEntry) {
      return run(sess.author({ t: "route", route: [sess.secret.start].concat(sess.secret.route), salts: sess.secret.salts }));
    }
  }

  // ------------------------------------------------------------------ sessions
  var current = null;

  function baseSession(role, code) {
    var sess = {
      role: role, code: code, myId: role === "host" ? "host" : S.deviceId(), name: S.settings().name || "Player",
      entries: [], state: null, seats: null, settings: { referee: C.net.defaultReferee, tactical: false, nDet: C.rules.detectivePawns },
      players: {}, roster: null, commit0: null, routeEntry: null, audit: null, secret: null, keys: null, offline: false,
      queue: Promise.resolve(), ctl: null, closed: false, gameId: null
    };
    sess.emit = function () { onSessionChange(sess); };
    return sess;
  }

  // Verifies and applies one entry; must run inside sess.queue so entries apply strictly in order.
  function ingestNow(sess, entry) {
    if (entry.n !== sess.entries.length) return Promise.resolve("gap");
    return verifyEntry(sess, entry).then(function (err) {
      if (err) { flagProblem(sess, "Rule check failed: " + err + "."); return "bad"; }
      if (entry.ev.t === "setup") sess.gameId = entry.n + ":" + (entry.sig || "").slice(0, 12);
      applyEntry(sess, entry);
      sess.lock = null;
      if (entry.ev.t === "route") return audit(sess).then(function (a) {
        sess.audit = a;
        if (a && !a.ok) flagProblem(sess, "Mr. X's route failed the audit: " + a.problems[0] + ". The detectives win.");
        else if (a) note(sess, "Every device checked Mr. X's full route: all of his moves were legal.");
        return "ok";
      });
      return "ok";
    });
  }
  // Queues an incoming entry (guest side, and the host when resuming), then updates the screen.
  function ingest(sess, entry) {
    sess.queue = sess.queue.then(function () { return ingestNow(sess, entry); }).then(function (res) {
      sess.emit();
      return res;
    }, function (e) { console.error(e); });
    return sess.queue;
  }
  function flagProblem(sess, text) {
    note(sess, text);
    sess.problem = text;
    setNet(text, "");
  }

  function onSessionChange(sess) {
    if (sess !== current) return;
    if (sess.pendingNotes && sess.state) { sess.pendingNotes.forEach(function (t) { note(sess, t); }); sess.pendingNotes = null; }
    if (sess.state) {
      if (!sess.ctl) {
        sess.ctl = new NetController(sess);
        sess.ctl.refresh();
        FY.UI.enterGame(sess.ctl);
      } else {
        sess.ctl.refresh();
        if (FY.UI.controller !== sess.ctl) FY.UI.enterGame(sess.ctl);
        if (sess.state.pending === "over") sess.ctl.emit({ t: "over" });
        else sess.ctl.emit({ t: "net" });
      }
      holderAuto(sess);
      if (sess.role === "host") { hostAuto(sess); persistHost(sess); }
      updateNet(sess);
    } else renderLobby();
  }

  // ------------------------------------------------------------------ host
  function genCode() {
    var A = C.net.codeAlphabet, s = "";
    for (var i = 0; i < C.net.codeLength; i++) s += A[Math.floor(Math.random() * A.length)];
    return s;
  }
  function persistHost(sess) {
    if (sess.role !== "host" || sess.closed) return;
    if (sess.state && sess.state.pending === "over" && sess.routeEntry) S.set("resume", null);
    S.set("host", { code: sess.code, entries: sess.entries, players: sess.players, settings: sess.settings, lobbySeats: sess.lobbySeats, keys: sess.keys && { pub: sess.keys.pub, priv: sess.keys.priv }, secret: sess.secret, over: !!(sess.state && sess.state.pending === "over" && sess.routeEntry) });
  }

  function hostSession(code, saved) {
    var sess = baseSession("host", code), T = transport();
    sess.players.host = { name: S.settings().name || "Game master", alias: S.settings().alias || "", key: null, online: true, fp: "" };
    sess.lobbySeats = { mrx: "host", roles: { host: "x" } };
    sess.conns = {};
    sess.author = function (ev) {
      return signEntry(sess, ev).then(function (entry) { return hostAccept(sess, entry, null); });
    };
    sess.send = function () {};
    sess.broadcast = function (msg) { Object.keys(sess.conns).forEach(function (id) { sess.conns[id].send(msg); }); };
    sess.close = function () {
      sess.closed = true;
      if (sess.state && sess.state.pending === "over") S.set("host", null);
      try { sess.listener && sess.listener.close(); } catch (e) {}
      clearInterval(sess.beat);
    };
    var ready = saved && saved.keys ? loadKeys(saved.keys) : subtle ? genKeys() : Promise.resolve(null);
    return ready.then(function (keys) {
      sess.keys = keys;
      if (keys) return fingerprint(keys.pub).then(function (fp) { sess.players.host.key = keys.pub; sess.players.host.fp = fp; });
    }).then(function () {
      if (saved) {
        sess.players = saved.players; sess.settings = saved.settings; sess.lobbySeats = saved.lobbySeats || sess.lobbySeats; sess.secret = saved.secret;
        Object.keys(sess.players).forEach(function (id) { if (id !== "host") sess.players[id].online = false; });
        sess.players.host.online = true;
        var es = saved.entries || [];
        return es.reduce(function (p, e) { return p.then(function () { return ingest(sess, e); }); }, Promise.resolve());
      }
    }).then(function () {
      return new Promise(function (resolve, reject) {
        sess.listener = T.listen(C.net.peerPrefix + code, function (conn, h) { hostConn(sess, conn, h); }, function () { resolve(sess); }, function (err) { reject(err); });
      });
    }).then(function () {
      sess.beat = setInterval(function () {
        var now = Date.now(), changed = false;
        Object.keys(sess.players).forEach(function (id) {
          var p = sess.players[id];
          if (id !== "host" && p.online && now - (p.seen || 0) > 12000) { p.online = false; changed = true; }
        });
        sess.broadcast({ t: "ping" });
        if (changed) { broadcastLobby(sess); sess.emit(); }
      }, 4000);
      return sess;
    });
  }

  function hostConn(sess, conn, h) {
    var who = null;
    h.data = function (m) {
      if (!m || typeof m !== "object" || sess.closed) return;
      if (who && sess.players[who]) sess.players[who].seen = Date.now();
      if (m.t === "hello") {
        var id = String(m.id || "").slice(0, 32), name = cleanName(m.name, 16) || "Player " + (Object.keys(sess.players).length + 1), alias = cleanName(m.alias, 20);
        if (!id || id === "host") return conn.send({ t: "error", text: "Bad hello." });
        var known = sess.players[id];
        var seated = Object.keys(sess.players).length;
        if (!known && (sess.state || seated >= C.players.maxInLobby)) return conn.send({ t: "error", text: sess.state ? "That game has already started." : "That game is full." });
        if (known && known.key && m.key && (known.key.x !== m.key.x || known.key.y !== m.key.y)) return conn.send({ t: "error", text: "This device's key changed; it can't rejoin that seat." });
        who = id;
        var p = sess.players[id] = known || { name: name, key: m.key || null };
        if (!known) { p.name = name; p.alias = alias; }
        p.online = true; p.seen = Date.now();
        if (sess.conns[id] && sess.conns[id] !== conn) try { sess.conns[id].close(); } catch (e) {}
        sess.conns[id] = conn;
        var fpDone = p.key && !p.fp && subtle ? fingerprint(p.key).then(function (fp) { p.fp = fp; }) : Promise.resolve();
        fpDone.then(function () {
          if (!sess.lobbySeats.roles[id]) sess.lobbySeats.roles[id] = playingCount(sess) >= C.players.max ? "watch" : "det";
          conn.send({ t: "welcome", code: sess.code, you: id });
          conn.send({ t: "sync", entries: sess.entries });
          broadcastLobby(sess);
          if (sess.state) sendSecretTo(sess, id);
          if (known && sess.state) hostNote(sess, p.name + " reconnected.");
          sess.emit();
        });
      } else if (m.t === "req" && who && m.entry) {
        var entry = { ev: m.entry.ev, by: m.entry.by, sig: m.entry.sig };
        if (entry.by !== who) return conn.send({ t: "reject", reason: "Requests must come from their author." });
        hostAccept(sess, entry, conn);
      } else if (m.t === "xreq" && who && sess.settings.referee === "trusted" && sess.seats && sess.seats.mrx === who) {
        var s = sess.state;
        if (!s || s.pending !== "x" || !sess.secret) return;
        var legal = R.xOptions(FY.UI.board, s, sess.secret.pos).some(function (o) { return o.to === (m.opt && m.opt.to) && o.tk === m.opt.tk; });
        if (!legal || (m.dbl && !R.canDouble(FY.UI.board, s, sess.secret) && s.xStep === 0)) return conn.send({ t: "reject", reason: "That move isn't legal." });
        holderMove(sess, { to: m.opt.to, tk: m.opt.tk }, !!m.dbl);
      } else if (m.t === "sync?") conn.send({ t: "sync", entries: sess.entries });
      else if (m.t === "profile" && who) hostProfile(sess, who, m.name, m.alias);
    };
    h.close = function () {
      if (who && sess.conns[who] === conn) {
        delete sess.conns[who];
        var p = sess.players[who];
        if (p) p.online = false;
        if (!sess.state) { delete sess.players[who]; delete sess.lobbySeats.roles[who]; }
        else hostNote(sess, (p ? p.name : "A player") + " disconnected.");
        broadcastLobby(sess);
        sess.emit();
      }
    };
  }
  function hostNote(sess, text) { sess.author({ t: "sys", text: text }); }
  function cleanName(v, n) { return String(v || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, n); }
  function playingCount(sess) {
    var roles = sess.lobbySeats.roles;
    return Object.keys(sess.players).filter(function (id) { return roles[id] && roles[id] !== "watch"; }).length;
  }
  // A player's new name or alias: in the lobby it just updates the list; during a game it
  // becomes a rename entry in the shared log so every device shows the new name.
  function hostProfile(sess, id, name, alias) {
    var p = sess.players[id];
    if (!p) return;
    name = cleanName(name, 16) || p.name; alias = cleanName(alias, 20);
    p.name = name; p.alias = alias;
    if (sess.state) sess.author({ t: "rename", id: id, name: name, alias: alias });
    broadcastLobby(sess);
    sess.emit();
  }
  function setProfile(sess, name, alias) {
    S.saveSetting("name", cleanName(name, 16)); S.saveSetting("alias", cleanName(alias, 20));
    if (sess.role === "host") hostProfile(sess, "host", name, alias);
    else { sess.name = cleanName(name, 16) || sess.name; sess.alias = cleanName(alias, 20); sess.send({ t: "profile", name: name, alias: alias }); }
  }

  // Appends an entry after the same checks every device will run, then relays it. Verification,
  // numbering and applying happen in one queued step, so entries can never interleave.
  function hostAccept(sess, entry, conn) {
    sess.queue = sess.queue.then(function () {
      if (sess.closed) return;
      // A detective move that arrives while Mr. X is still answering a capture check waits its turn.
      if (entry.ev && entry.ev.t === "d" && sess.state && sess.state.pending === "probe") { (sess.deferred = sess.deferred || []).push([entry, conn]); return; }
      var probe = { n: sess.entries.length, ev: entry.ev, by: entry.by, sig: entry.sig };
      return verifyEntry(sess, probe).then(function (err) {
        if (err) { if (conn) conn.send({ t: "reject", reason: err }); else console.warn("rejected own entry:", err); return; }
        sess.broadcast({ t: "entry", entry: probe });
        return ingestNow(sess, probe).then(function () {
          if (sess.deferred && sess.state && sess.state.pending !== "probe") {
            var waiting = sess.deferred; sess.deferred = null;
            waiting.forEach(function (w) { hostAccept(sess, w[0], w[1]); });
          }
        });
      });
    }).then(function () { sess.emit(); }, function (e) { console.error(e); });
    return sess.queue;
  }

  function sendSecretTo(sess, id) {
    if (sess.settings.referee !== "trusted" || !sess.seats || sess.seats.mrx !== id || !sess.secret || !sess.conns[id]) return;
    sess.conns[id].send({ t: "secret", secret: sess.secret, gameId: sess.gameId });
  }
  function hostAuto(sess) {
    if (sess.settings.referee === "trusted" && sess.seats) sendSecretTo(sess, sess.seats.mrx);
  }

  function broadcastLobby(sess) {
    if (sess.role === "host") persistHost(sess);
    // With more detective players than pieces, add pieces (up to the maximum) so everyone plays.
    if (!sess.state) {
      var dp = Object.keys(sess.players).filter(function (id) { return sess.lobbySeats.roles[id] === "det"; }).length;
      if (dp > sess.settings.nDet) sess.settings.nDet = Math.min(C.rules.maxDetectivePawns, dp);
    }
    var info = lobbyInfo(sess);
    sess.broadcast({ t: "lobby", info: info });
    if (current === sess) renderLobby();
  }
  function lobbyInfo(sess) {
    var players = {};
    Object.keys(sess.players).forEach(function (id) { var p = sess.players[id]; players[id] = { name: p.name, alias: p.alias || "", fp: p.fp || "", online: !!p.online }; });
    return { code: sess.code, players: players, roles: sess.lobbySeats.roles, settings: sess.settings, started: !!sess.state };
  }

  // Seats from the lobby: one Mr. X, detective pawns shared round-robin between detective players.
  function seatsFromLobby(sess) {
    var roles = sess.lobbySeats.roles, ids = Object.keys(sess.players);
    var mrx = ids.filter(function (id) { return roles[id] === "x"; })[0];
    var dets = ids.filter(function (id) { return roles[id] === "det"; });
    var n = sess.settings.nDet, pawns = [];
    for (var i = 0; i < n; i++) pawns.push(dets[i % dets.length]);
    return { mrx: mrx, pawns: pawns };
  }
  function lobbyProblem(sess) {
    var roles = sess.lobbySeats.roles, ids = Object.keys(sess.players);
    var xs = ids.filter(function (id) { return roles[id] === "x"; }), ds = ids.filter(function (id) { return roles[id] === "det"; });
    var playing = xs.length + ds.length;
    if (xs.length !== 1) return "Choose exactly one Mr. X.";
    if (!ds.length) return "At least one player must be a detective.";
    if (playing < C.players.min) return "You need at least " + C.players.min + " players.";
    if (playing > C.players.max) return "At most " + C.players.max + " players can play.";
    if (ids.some(function (id) { return roles[id] !== "watch" && !sess.players[id].online; })) return "Someone with a role is offline.";
    return null;
  }

  function hostStartGame(sess) {
    var seats = seatsFromLobby(sess), board = FY.UI.board;
    var roster = {};
    Object.keys(sess.players).forEach(function (id) { roster[id] = { name: sess.players[id].name, alias: sess.players[id].alias || "", key: sess.players[id].key, fp: sess.players[id].fp }; });
    var rules = R.makeRules(C.rules, sess.settings.nDet);
    var made = R.setup(board, rules);
    sess.secret = null;
    sess.entries = []; sess.state = null; sess.commit0 = null; sess.routeEntry = null; sess.audit = null; sess.problem = null;
    sess.queue = Promise.resolve();
    if (sess.ctl) { sess.ctl.destroy(); sess.ctl = null; }
    sess.broadcast({ t: "reset" });
    return sess.author({ t: "setup", seats: seats, players: roster, settings: sess.settings }).then(function () {
      return sess.author(made.start);
    });
  }

  // ------------------------------------------------------------------ guest
  function guestSession(code, name) {
    var sess = baseSession("guest", code), T = transport(), saved = S.get("guest", null);
    sess.name = name;
    sess.alias = S.settings().alias || "";
    sess.tries = 0;
    var ready = saved && saved.keys ? loadKeys(saved.keys) : subtle ? genKeys() : Promise.resolve(null);
    sess.secret = S.get("xsecret." + code, null);
    sess.author = function (ev) {
      return signEntry(sess, ev).then(function (entry) { sess.send({ t: "req", entry: entry }); });
    };
    sess.send = function (m) { if (sess.conn && sess.conn.open) sess.conn.send(m); };
    sess.close = function () { sess.closed = true; clearInterval(sess.beat); clearTimeout(sess.retry); try { sess.conn && sess.conn.close(); } catch (e) {} };
    function connect() {
      if (sess.closed) return;
      sess.conn = T.connect(C.net.peerPrefix + code, {
        open: function () {
          sess.tries = 0; sess.offline = false; sess.lastSeen = Date.now();
          sess.send({ t: "hello", id: sess.myId, name: sess.name, alias: sess.alias, key: sess.keys && sess.keys.pub });
        },
        data: function (m) { sess.lastSeen = Date.now(); guestMsg(sess, m); },
        close: function () { lost(); },
        error: function (type) { if (!sess.everJoined && type === "peer-unavailable") fail("No game found with code " + code + ". Check the code and make sure the game master has it open."); else lost(); }
      });
    }
    function lost() {
      if (sess.closed) return;
      sess.offline = true;
      sess.emit();
      clearTimeout(sess.retry);
      if (!sess.lostAt) sess.lostAt = Date.now();
      if (Date.now() - sess.lostAt > C.net.reconnectGiveUpMs) return fail("Lost the connection to the game master.");
      sess.retry = setTimeout(function () { try { sess.conn && sess.conn.close(); } catch (e) {} connect(); }, C.net.reconnectEveryMs);
    }
    function fail(text) { sess.close(); if (current === sess) { current = null; openHome(text); } }
    sess.lost = lost;
    return ready.then(function (keys) {
      sess.keys = keys;
      S.set("guest", { code: code, name: name, keys: keys && { pub: keys.pub, priv: keys.priv } });
      connect();
      sess.beat = setInterval(function () {
        if (sess.closed) return;
        sess.send({ t: "ping" });
        if (!sess.offline && sess.lastSeen && Date.now() - sess.lastSeen > 12000) lost();
      }, 4000);
      return sess;
    });
  }
  function guestMsg(sess, m) {
    if (!m || typeof m !== "object") return;
    if (m.t === "welcome") { sess.everJoined = true; sess.lostAt = 0; sess.offline = false; sess.emit(); }
    else if (m.t === "lobby") { sess.lobby = m.info; if (!sess.state) renderLobby(); }
    else if (m.t === "reset") { sess.entries = []; sess.state = null; sess.commit0 = null; sess.routeEntry = null; sess.audit = null; sess.problem = null; sess.queue = Promise.resolve(); if (sess.ctl) { sess.ctl.destroy(); sess.ctl = null; } }
    else if (m.t === "sync") {
      // Rebuild from the full log, verifying every entry again.
      var es = m.entries || [];
      if (es.length >= sess.entries.length && es.slice(0, sess.entries.length).every(function (e, i) { return e.sig === sess.entries[i].sig && JSON.stringify(e.ev) === JSON.stringify(sess.entries[i].ev); })) {
        es.slice(sess.entries.length).forEach(function (e) { ingest(sess, e); });
      } else {
        sess.entries = []; sess.state = null; sess.commit0 = null; sess.routeEntry = null; sess.queue = Promise.resolve();
        es.forEach(function (e) { ingest(sess, e); });
      }
      sess.queue.then(function () { sess.emit(); });
    } else if (m.t === "entry" && m.entry) {
      ingest(sess, m.entry).then(function (res) { if (res === "gap") sess.send({ t: "sync?" }); });
    } else if (m.t === "secret" && m.secret) { sess.secret = m.secret; S.set("xsecret." + sess.code, m.secret); sess.emit(); }
    else if (m.t === "reject") { sess.lock = null; FY.UI.toast("Move not accepted", String(m.reason || "")); sess.emit(); }
    else if (m.t === "error") { var text = String(m.text || "Error"); sess.close(); current = null; openHome(text); }
  }

  // ------------------------------------------------------------------ connection banner
  function setNet(text, cls) {
    var el = $("#net");
    if (!el) return;
    if (!text) { el.classList.add("hidden"); return; }
    el.textContent = text;
    el.className = cls || "";
  }
  function updateNet(sess) {
    if (sess.problem) return setNet(sess.problem, "");
    if (sess.offline) return setNet("Connection lost. Reconnecting…", "");
    var s = sess.state;
    if (sess.role === "host" && s && s.pending !== "over") {
      var off = Object.keys(sess.players).filter(function (id) { return id !== "host" && !sess.players[id].online && (sess.seats.mrx === id || sess.seats.pawns.indexOf(id) >= 0); });
      if (off.length) return setNet(off.map(function (id) { return sess.players[id].name; }).join(", ") + " offline. Waiting, or reassign their pieces from the menu.", "wait");
    }
    if (s && s.pending !== "over" && !sess.commit0) return setNet("Waiting for Mr. X to pick a starting point…", "wait");
    if (s && (s.pending === "probe" || (s.pending === "x" && !(sess.ctl && sess.ctl.humanX)))) {
      var mx = sess.seats.mrx, mp = (sess.lobby && sess.lobby.players && sess.lobby.players[mx]) || sess.players[mx];
      if (mp && mp.online === false) return setNet("Mr. X is offline. The game continues when he reconnects.", "wait");
    }
    setNet("");
  }

  // ------------------------------------------------------------------ screens
  function openHome(msg) {
    FY.UI.show("online");
    var hostSaved = S.get("host", null), guestSaved = S.get("guest", null), st = S.settings();
    var ok = transport().available();
    var h = '<button class="linkbtn back" data-net="back">&larr; Back</button><h2 class="disp">Play online</h2>' +
      (msg ? '<p class="note" style="color:var(--bad);font-weight:700">' + FY.UI.esc(msg) + "</p>" : "") +
      '<input class="txt" id="nName" maxlength="16" placeholder="Your name" autocomplete="nickname" aria-label="Your name" value="' + FY.UI.esc(st.name || "") + '">' +
      '<input class="txt" id="nAlias" maxlength="20" placeholder="Alias for your role (optional, e.g. Moriarty)" aria-label="Alias (optional)" value="' + FY.UI.esc(st.alias || "") + '">' +
      '<button class="role" data-net="host"' + (ok ? "" : " disabled") + "><b>Host a game</b><span>You're the game master: share a code, hand out roles, and play Mr. X, a detective, or just referee.</span></button>" +
      '<div class="joinrow"><input id="nCode" maxlength="' + C.net.codeLength + '" placeholder="CODE" autocapitalize="characters" autocomplete="off" spellcheck="false" aria-label="Game code"><button class="btn pri" data-net="join"' + (ok ? "" : " disabled") + ">Join game</button></div>" +
      (hostSaved && hostSaved.code && !hostSaved.over ? '<button class="btn" data-net="resume">Resume hosting game ' + hostSaved.code + "</button>" : "") +
      (guestSaved && guestSaved.code ? '<button class="btn" data-net="rejoin">Rejoin game ' + guestSaved.code + "</button>" : "") +
      '<p class="note">' + (ok ? "Players connect directly to each other. If a friend can't connect, try the same Wi-Fi or turn off a VPN; the site owner can also add a TURN server in js/config.js." : "Online play couldn't load (check your connection and reload).") + "</p>";
    $("#onlineInner").innerHTML = h;
  }
  function nameValue() {
    var v = cleanName($("#nName") && $("#nName").value, 16), a = cleanName($("#nAlias") && $("#nAlias").value, 20);
    S.saveSetting("name", v); S.saveSetting("alias", a);
    return v;
  }
  function startHosting(saved) {
    if (current) current.close();
    var code = saved ? saved.code : genCode(), name = saved ? null : nameValue() || "Game master";
    $("#onlineInner").innerHTML = '<p class="note">Opening game ' + code + "…</p>";
    hostSession(code, saved).then(function (sess) {
      current = sess;
      S.set("resume", { kind: "host", code: code });
      if (name) { sess.players.host.name = name; sess.players.host.alias = S.settings().alias || ""; }
      if (sess.state) onSessionChange(sess); else renderLobby();
    }, function (err) {
      if (err === "unavailable-id" && !saved) return startHosting(null);
      openHome(err === "unavailable-id" ? "That code is still held by the matchmaking server; try Resume again in a minute." : "Couldn't reach the matchmaking server. Check your connection and try again.");
    });
  }
  function joinGame(code, name) {
    if (current) current.close();
    $("#onlineInner").innerHTML = '<p class="note">Connecting to ' + code + "…</p>";
    guestSession(code, name).then(function (sess) { current = sess; S.set("resume", { kind: "guest", code: code }); renderLobby(); });
  }

  var ui_edit = false;
  function renderLobby() {
    var sess = current;
    if (!sess || sess.state || $("#online").classList.contains("hidden")) return;
    var host = sess.role === "host", info = host ? lobbyInfo(sess) : sess.lobby;
    var h = '<button class="linkbtn back" data-net="leave">&larr; Leave</button><h2 class="disp">Game lobby</h2>';
    h += '<div class="codebig" aria-label="Game code">' + sess.code + "</div>";
    h += '<div class="row"><button class="btn grow" data-net="share">Share invite</button></div>';
    if (!info) { $("#onlineInner").innerHTML = h + '<p class="note">' + (sess.offline ? "Connecting…" : "Waiting for the game master…") + "</p>"; return; }
    var roleNames = { x: "Mr. X", det: "Detective", watch: "Watching" };
    h += '<div class="sect">Players</div><div class="plist">';
    Object.keys(info.players).forEach(function (id) {
      var p = info.players[id], r = info.roles[id] || "det";
      h += '<div class="pl"><span class="who">' + FY.UI.esc(p.alias ? p.alias + " (" + p.name + ")" : p.name) + (id === sess.myId ? " · you" : "") + (id === "host" ? " · game master" : "") + "</span>" +
        (id === sess.myId ? '<button class="btn sm" data-net="editme">Edit</button>' : "") +
        (p.fp ? '<span class="note" title="Key fingerprint">🔑 ' + p.fp + "</span>" : "") + (p.online ? "" : '<span class="off">offline</span>');
      if (host) {
        h += '<div class="seg" style="flex-basis:100%">' + ["x", "det", "watch"].map(function (k) {
          return '<button type="button" aria-checked="' + (r === k) + '" data-role="' + k + '" data-pid="' + id + '">' + roleNames[k] + "</button>";
        }).join("") + "</div>";
      } else h += '<span class="rl">' + roleNames[r] + "</span>";
      h += "</div>";
    });
    h += "</div>";
    if (ui_edit) {
      var me = info.players[sess.myId] || { name: sess.name || "", alias: sess.alias || "" };
      h += '<div class="pl" style="flex-direction:column;align-items:stretch"><input class="txt" id="eName" maxlength="16" placeholder="Your name" value="' + FY.UI.esc(me.name || "") + '">' +
        '<input class="txt" id="eAlias" maxlength="20" placeholder="Alias for your role (optional)" value="' + FY.UI.esc(me.alias || "") + '">' +
        '<div class="row"><button class="btn pri grow" data-net="saveme">Save</button><button class="btn grow" data-net="canceledit">Cancel</button></div></div>';
    }
    var st = info.settings;
    if (host) {
      var counts = [];
      for (var c = C.rules.minDetectivePawns; c <= C.rules.maxDetectivePawns; c++) counts.push(c);
      h += '<label class="field"><span>Detectives on the board</span><div class="seg">' + counts.map(function (n) { return '<button type="button" aria-checked="' + (st.nDet === n) + '" data-ndet="' + n + '">' + n + "</button>"; }).join("") + "</div></label>";
      h += '<label class="field"><span>Referee</span><div class="seg">' +
        '<button type="button" aria-checked="' + (st.referee === "verified") + '" data-ref="verified"' + (subtle ? "" : " disabled") + ">Verified</button>" +
        '<button type="button" aria-checked="' + (st.referee === "trusted") + '" data-ref="trusted">Trusted game master</button></div></label>';
      h += '<p class="note">' + (st.referee === "verified" ? "Nobody can cheat unnoticed: moves are signed on each player's device, Mr. X's position never leaves his device, and every device checks his whole route at the end." : "Simpler: your device holds Mr. X's position and you can see it. Players must trust you.") + "</p>";
      h += '<label class="switch"><input type="checkbox" data-net="tactical"' + (st.tactical ? " checked" : "") + "><span>Allow tactical hints for everyone</span></label>";
      h += '<div class="row"><button class="btn grow" data-net="shuffle">Random Mr. X</button></div>';
      var prob = lobbyProblem(sess);
      h += '<p class="note">' + (prob || "Ready. Detective pieces are shared out between detective players." + (st.nDet > 5 ? " More than 5 detectives is a big-group variant: Mr. X gets a black ticket for each one." : "")) + "</p>";
      h += '<button class="btn pri big" data-net="start"' + (prob ? " disabled" : "") + ">Start game</button>";
    } else {
      h += '<p class="note">Referee: ' + (st.referee === "verified" ? "verified (no one can cheat unnoticed)" : "trusted game master (the game master can see Mr. X)") + (st.tactical ? "; tactical hints allowed" : "") + ".</p>";
      h += '<p class="note">' + (sess.offline ? "Connection lost. Reconnecting…" : "Waiting for the game master to start.") + " Compare the 🔑 fingerprints out loud to be sure nobody is impersonated.</p>";
    }
    $("#onlineInner").innerHTML = h;
  }

  function seatsDialog(sess) {
    if (!sess.state) return;
    var ids = Object.keys(sess.players), h = '<h2 class="disp">Players and seats</h2><p class="note">Hand a piece to another player, for example when someone has left.</p><div class="plist">';
    var rows = [{ key: "mrx", label: "Mr. X", id: sess.seats.mrx }].concat(sess.seats.pawns.map(function (id, i) { return { key: i, label: "D" + (i + 1), id: id }; }));
    rows.forEach(function (r) {
      var lock = r.key === "mrx" && sess.settings.referee !== "trusted";
      h += '<div class="pl"><span class="who">' + r.label + "</span><select data-seat=\"" + r.key + '"' + (lock ? " disabled" : "") + ' aria-label="Who plays ' + r.label + '">' +
        ids.map(function (id) { return '<option value="' + id + '"' + (id === r.id ? " selected" : "") + ">" + FY.UI.esc(labelOf(sess, id)) + (sess.players[id].online ? "" : " (offline)") + "</option>"; }).join("") + "</select></div>";
    });
    h += '</div><p class="note">' + (sess.settings.referee === "trusted" ? "" : "In verified games Mr. X can't be handed over: only his device knows where he is.") + '</p><button class="btn pri" data-act="close">Done</button>';
    FY.UI.overlay(h, function (card) {
      card.querySelectorAll("select").forEach(function (sel) {
        sel.onchange = function () {
          var k = sel.getAttribute("data-seat");
          sess.author({ t: "seat", pawn: k === "mrx" ? "mrx" : +k, to: sel.value });
        };
      });
    });
  }
  function profileDialog(sess) {
    var me = (sess.roster || {})[sess.myId] || {};
    FY.UI.overlay('<h2 class="disp">Your name</h2><p class="note">Everyone in the game will see the change.</p>' +
      '<label class="field"><span>Name</span><input class="txt" id="pName" maxlength="16" value="' + FY.UI.esc(me.name || "") + '"></label>' +
      '<label class="field"><span>Alias for your role <small class="note">(optional)</small></span><input class="txt" id="pAlias" maxlength="20" value="' + FY.UI.esc(me.alias || "") + '" placeholder="e.g. Moriarty or Inspector Holmes"></label>' +
      '<div class="row"><button class="btn pri grow" id="pSave">Save</button><button class="btn grow" data-act="close">Cancel</button></div>', function (card) {
      card.querySelector("#pSave").onclick = function () { setProfile(sess, card.querySelector("#pName").value, card.querySelector("#pAlias").value); FY.UI.closeLayers(); };
    });
  }
  function keysDialog(sess) {
    var ro = sess.roster || {}, h = '<h2 class="disp">Fingerprints</h2><p class="note">Each device signs its moves with its own key. Compare these out loud: if they match on every device, nobody can pretend to be someone else.</p><div class="plist">';
    Object.keys(ro).forEach(function (id) { h += '<div class="pl"><span class="who">' + FY.UI.esc(labelOf(sess, id)) + (id === sess.myId ? " (you)" : "") + '</span><span class="rl">🔑 ' + (ro[id].fp || "–") + "</span></div>"; });
    FY.UI.overlay(h + '</div><button class="btn pri" data-act="close">Close</button>');
  }

  // ------------------------------------------------------------------ wiring
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-net],[data-role],[data-ndet],[data-ref]");
    if (!t || !$("#onlineInner").contains(t)) return;
    var sess = current, a = t.getAttribute("data-net");
    if (t.hasAttribute("data-role") && sess && sess.role === "host") {
      var id = t.getAttribute("data-pid"), role = t.getAttribute("data-role");
      if (role === "x") Object.keys(sess.lobbySeats.roles).forEach(function (k) { if (sess.lobbySeats.roles[k] === "x") sess.lobbySeats.roles[k] = "det"; });
      sess.lobbySeats.roles[id] = role;
      return broadcastLobby(sess);
    }
    if (t.hasAttribute("data-ndet") && sess) { sess.settings.nDet = +t.getAttribute("data-ndet"); return broadcastLobby(sess); }
    if (t.hasAttribute("data-ref") && sess) { sess.settings.referee = t.getAttribute("data-ref"); return broadcastLobby(sess); }
    if (a === "back") { FY.UI.show("menu"); return; }
    if (a === "editme") { ui_edit = true; return renderLobby(); }
    if (a === "canceledit") { ui_edit = false; return renderLobby(); }
    if (a === "saveme" && sess) { ui_edit = false; setProfile(sess, $("#eName").value, $("#eAlias").value); return renderLobby(); }
    if (a === "host") return startHosting(null);
    if (a === "resume") return startHosting(S.get("host", null));
    if (a === "join") {
      var code = ($("#nCode").value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (code.length !== C.net.codeLength) return openHome("Enter the " + C.net.codeLength + "-letter code.");
      return joinGame(code, nameValue());
    }
    if (a === "rejoin") { var g = S.get("guest", null); return joinGame(g.code, g.name || nameValue()); }
    if (a === "leave") { if (sess) sess.close(); current = null; S.set("resume", null); if (sess && sess.role === "host") S.set("host", null); return openHome(); }
    if (a === "share" && sess) {
      var txt = "Join my Fog Yard game with code " + sess.code;
      var url = location.href.split("?")[0].split("#")[0];
      if (navigator.share) navigator.share({ title: "Fog Yard", text: txt, url: url }).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(txt + " at " + url).then(function () { FY.UI.toast("Invite copied", txt); }, function () {});
      return;
    }
    if (a === "shuffle" && sess) {
      var ids = Object.keys(sess.players).filter(function (k) { return sess.lobbySeats.roles[k] !== "watch"; });
      if (!ids.length) return;
      var x = ids[Math.floor(Math.random() * ids.length)];
      ids.forEach(function (k) { sess.lobbySeats.roles[k] = k === x ? "x" : "det"; });
      return broadcastLobby(sess);
    }
    if (a === "start" && sess && !lobbyProblem(sess)) return hostStartGame(sess);
  });
  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t.getAttribute && t.getAttribute("data-net") === "tactical" && current) { current.settings.tactical = t.checked; broadcastLobby(current); }
  });

  FY.Net = {
    // Called at start-up after a refresh: rejoin or resume the game this device was in.
    autoResume: function (r) {
      if (r.kind === "host") {
        var saved = S.get("host", null);
        if (!saved || saved.code !== r.code || saved.over) return S.set("resume", null);
        FY.UI.show("online");
        startHosting(saved);
      } else {
        var g = S.get("guest", null);
        if (!g || g.code !== r.code) return S.set("resume", null);
        FY.UI.show("online");
        joinGame(g.code, g.name || "Player");
      }
    },
    open: function () {
      if (current && !current.closed) { if (current.state && current.ctl) FY.UI.enterGame(current.ctl); else renderLobby(); return; }
      openHome();
    },
    get session() { return current; },
    _audit: audit, _verify: verifyEntry, _sign: signEntry, _apply: applyEntry, _keys: genKeys, _sha: sha256, _commit: commitStr
  };
})(window.FY = window.FY || {});
