/* Shadow Line game controller. Runs one game for this device: who controls which side, the
   automatic steps (Mr. X's capture answers, trap detection, computer moves) and autosave.
   The UI reads ctl.s (public state), ctl.secret (only on Mr. X's device) and calls
   ctl.moveX / ctl.moveDet. The online layer replaces submit() to send events over the network. */
(function (FY) {
  "use strict";
  var R = FY.Rules;

  function Controller(board, opts) {
    this.board = board;
    this.opts = opts; // {mode, role:"x"|"det", nDet, level, seed}
    this.listeners = [];
    this.token = 0;
    this.busy = false; // a computer player is thinking
    this.xPlan = null; // remaining half of a computer double move
  }

  Controller.prototype.newGame = function () {
    var o = this.opts, rules = R.makeRules(FY.CONFIG.rules, o.nDet);
    var made = R.setup(this.board, rules);
    this.secret = made.secret;
    this.s = R.init(this.board, made.start);
    this.assign();
    this.save();
    this.kick();
    return this;
  };

  Controller.prototype.resume = function (saved) {
    this.opts = saved.opts;
    this.s = R.replay(this.board, saved.events);
    this.secret = saved.secret;
    this.assign();
    this.kick();
    return this;
  };

  // Who is human on this device: in solo play one side is human, the other the computer.
  Controller.prototype.assign = function () {
    var n = this.s.dets.length, all = [];
    for (var i = 0; i < n; i++) all.push(i);
    this.humanX = this.opts.role === "x";
    this.myDets = this.opts.role === "det" ? all : [];
    this.aiDets = this.opts.role === "det" ? [] : all;
    this.view = this.opts.role; // what this device may see: "x" sees Mr. X, "det" does not
  };

  Controller.prototype.on = function (fn) { this.listeners.push(fn); };
  Controller.prototype.emit = function (what) {
    var self = this;
    this.listeners.forEach(function (fn) { fn(what, self); });
  };
  Controller.prototype.destroy = function () { this.token++; this.listeners = []; };

  Controller.prototype.save = function () {
    if (this.opts.mode !== "solo") return;
    if (this.s.pending === "over") FY.Store.set("solo", null);
    else FY.Store.set("solo", { opts: this.opts, events: this.s.events, secret: this.secret, at: Date.now() });
  };

  Controller.prototype.submit = function (ev) {
    R.apply(this.board, this.s, ev);
    this.save();
    this.emit(ev);
  };

  // ---- human actions ----
  Controller.prototype.xOptions = function () {
    return this.secret ? R.xOptions(this.board, this.s, this.secret.pos) : [];
  };
  Controller.prototype.canDouble = function () {
    return !!this.secret && R.canDouble(this.board, this.s, this.secret);
  };
  Controller.prototype.isMyXTurn = function () {
    return this.humanX && this.s.pending === "x" && !this.busy;
  };
  Controller.prototype.myTurnDets = function () {
    var s = this.s, self = this;
    if (s.pending !== "det" || this.busy) return [];
    return this.myDets.filter(function (i) { return !s.moved[i] && R.detOptions(self.board, s, i).length; });
  };
  Controller.prototype.moveX = function (opt, dbl) {
    if (!this.isMyXTurn()) return false;
    var ev = R.xMove(this.board, this.s, this.secret, opt, dbl);
    this.submit(ev);
    this.kick();
    return true;
  };
  Controller.prototype.moveDet = function (i, opt) {
    if (this.myTurnDets().indexOf(i) < 0) return false;
    this.submit({ t: "d", i: i, to: opt.to, tk: opt.tk });
    this.kick();
    return true;
  };

  // ---- automatic steps ----
  Controller.prototype.kick = function () {
    var self = this, s = this.s, tok = ++this.token;
    if (s.pending === "over") { this.busy = false; this.emit({ t: "over" }); return; }
    if (s.pending === "probe" && this.secret) return this.submitAndKick(R.probeFor(s, this.secret));
    if (s.pending === "x" && this.secret && s.xStep === 0 && R.isTrapped(this.board, s, this.secret)) return this.submitAndKick({ t: "trapped" });
    if (s.pending === "x" && !this.humanX) {
      this.busy = true; this.emit({ t: "thinking", who: "x" });
      setTimeout(function () {
        if (tok !== self.token) return;
        if (!self.xPlan) self.xPlan = FY.AI.chooseX(self.board, self.s, self.secret, Math.random, self.opts.level);
        var o = self.xPlan.moves.shift(), dbl = self.xPlan.double;
        if (!self.xPlan.moves.length) self.xPlan = null;
        self.busy = false;
        self.submitAndKick(R.xMove(self.board, self.s, self.secret, o, dbl));
      }, FY.CONFIG.ai.thinkMs);
      return;
    }
    if (s.pending === "det") {
      var ai = this.aiDets.filter(function (i) { return !s.moved[i] && R.detOptions(self.board, s, i).length; });
      if (ai.length && !this.myTurnDets().length) {
        this.busy = true; this.emit({ t: "thinking", who: "det" });
        setTimeout(function () {
          if (tok !== self.token) return;
          var mv = FY.AI.chooseDet(self.board, self.s, Math.random, ai, self.opts.level);
          self.busy = false;
          self.submitAndKick({ t: "d", i: mv.i, to: mv.to, tk: mv.tk });
        }, FY.CONFIG.ai.stepMs);
        return;
      }
    }
    this.busy = false;
    this.emit({ t: "wait" });
  };
  Controller.prototype.submitAndKick = function (ev) {
    this.submit(ev);
    this.kick();
  };

  // Display names: "Mr. X" or the player's alias, with the player's name in brackets.
  Controller.prototype.xShort = function () { return (this.opts.role === "x" && this.opts.alias) || "Mr. X"; };
  Controller.prototype.xLabel = function () {
    return this.xShort() + (this.opts.role === "x" ? (this.opts.name ? " (" + this.opts.name + ")" : "") : " (computer)");
  };
  Controller.prototype.detOwnerLabel = function () { return this.opts.role === "det" ? "" : "computer"; };
  Controller.prototype.myName = function () { return this.opts.name || ""; };

  // Mr. X's route, known to this device (always at the end of a solo game).
  Controller.prototype.route = function () {
    return this.secret ? [this.secret.start].concat(this.secret.route) : null;
  };

  FY.Controller = Controller;
})(window.FY = window.FY || {});
