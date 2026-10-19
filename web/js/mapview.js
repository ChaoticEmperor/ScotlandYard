/* Find Mr. X: SVG board with pinch zoom, drag pan, wheel zoom and nearest-station tapping. */
(function (FY) {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";
  var COL = { taxi: "#f2c12e", bus: "#16a085", underground: "#e2382c", ferry: "#7cc8ff" };
  var CASE = "rgba(18,26,20,.72)";
  var WIDTH = { taxi: 3.4, bus: 3, underground: 3.6, ferry: 3.4 };
  var ROAD = { w: 11, fill: "#fbf6e6", edge: "rgba(110,80,25,.55)" };
  var MAX_SCALE = 2.6;

  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function MapView(container, board, scene, opts) {
    this.c = container; this.b = board; this.s = scene; this.opts = opts || {};
    this.onTap = this.opts.onTap || function () {};
    this.svg = el("svg", { "class": "fy-map", role: "img", "aria-label": "Find Mr. X board" }, container);
    this.build();
    this.VB = { x: 0, y: 0, w: board.W, h: board.H };
    this.fit();
    if (this.opts.static) {
      var me = this;
      this.svg.addEventListener("click", function (e) { var u = me.toUser(e.clientX, e.clientY); me.onTap(me.stationAt(u.x, u.y)); });
    } else this.gestures();
    var self = this;
    this._ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(function () { self.resize(); }) : null;
    if (this._ro) this._ro.observe(container); else window.addEventListener("resize", function () { self.resize(); });
  }

  MapView.prototype.build = function () {
    var b = this.b, s = this.s, svg = this.svg, g, i;
    el("rect", { x: 0, y: 0, width: b.W, height: b.H, fill: "#7aae4e" }, svg);
    this.bg = el("image", { x: 0, y: 0, width: b.W, height: b.H, preserveAspectRatio: "none" }, svg);

    // Routes: all casings first so every crossing stays readable, then the colours.
    var layers = ["ferry", "taxi", "bus", "underground"];
    var byType = {};
    layers.forEach(function (t) { byType[t] = []; });
    s.routes.forEach(function (r) { byType[r.e.t].push(r); });
    s.ferries.forEach(function (r) { byType.ferry.push(r); });
    // Bridge decks where roads cross the river, under the routes so the road runs across them.
    g = el("g", { "class": "bridges" }, svg);
    s.bridges.forEach(function (br) {
      var L = br.w + 18, deg = (br.angle * 180) / Math.PI, tf = "translate(" + br.x.toFixed(1) + " " + br.y.toFixed(1) + ") rotate(" + deg.toFixed(1) + ")";
      var d = el("g", { transform: tf }, g);
      el("rect", { x: -L / 2 + 2, y: -6.5, width: L, height: 17, fill: "rgba(10,30,40,.3)" }, d);
      el("rect", { x: -L / 2, y: -8.5, width: L, height: 17, rx: 2, fill: "#cfc6b4", stroke: "#6f6a5e", "stroke-width": 1.4 }, d);
      for (var px = -L / 2 + 4; px < L / 2 - 2; px += 6) el("rect", { x: px, y: -9.4, width: 2.2, height: 2.4, fill: "#6f6a5e" }, d), el("rect", { x: px, y: 7, width: 2.2, height: 2.4, fill: "#6f6a5e" }, d);
    });
    // Taxi links are the streets: a cream road with yellow kerbs. Bus lanes run along them,
    // underground and ferry lines sit on top with dark casings.
    g = el("g", { "class": "routes", fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" }, svg);
    byType.taxi.forEach(function (r) { el("path", { d: r.d, stroke: ROAD.edge, "stroke-width": ROAD.w + 2.2 }, g); });
    byType.taxi.forEach(function (r) { el("path", { d: r.d, stroke: COL.taxi, "stroke-width": ROAD.w }, g); });
    byType.taxi.forEach(function (r) { el("path", { d: r.d, stroke: ROAD.fill, "stroke-width": ROAD.w - 4.4 }, g); });
    ["ferry", "bus", "underground"].forEach(function (t) {
      byType[t].forEach(function (r) { el("path", { d: r.d, stroke: CASE, "stroke-width": WIDTH[t] + (r.lanes ? 1.6 : 3.4) }, g); });
    });
    ["ferry", "bus", "underground"].forEach(function (t) {
      byType[t].forEach(function (r) {
        var a = { d: r.d, stroke: COL[t], "stroke-width": WIDTH[t] };
        if (t === "underground") a["stroke-dasharray"] = "9 5";
        if (t === "ferry") { a["stroke-dasharray"] = "0.1 7.5"; a["stroke-width"] = 4.2; }
        el("path", a, g);
      });
    });
    this.routeHi = el("g", { "class": "route-hi", fill: "none", "stroke-linecap": "round" }, svg);

    // Feature labels for the painted terrain; hidden when a map image (with its own names) is used.
    g = this.labels = el("g", { "class": "labels", visibility: "hidden" }, svg);
    var F = s.features;
    F.mountains.forEach(function (d) { if (d.name) label(g, d.x, d.y + d.r * 0.62 + 14, d.name, "lbl lbl-mtn"); });
    F.lakes.forEach(function (d) { if (d.name) label(g, d.x, d.y + 4, d.name, "lbl lbl-lake"); });
    F.groves.forEach(function (d) { if (d.name) label(g, d.x, d.y + 4, d.name, "lbl lbl-grove"); });

    // Stations: underground ring outside the bus ring, then the numbered disc.
    this.hiLayer = el("g", { "class": "hi" }, svg);
    g = el("g", { "class": "stations" }, svg);
    for (i = 1; i <= b.N; i++) {
      var p = b.pos[i], k = b.kind[i];
      if (k === "underground") ring(g, p, 20.5, COL.underground);
      if (k !== "taxi") ring(g, p, 16.5, COL.bus);
      if (s.piers[i]) ring(g, p, k === "underground" ? 24.5 : k === "bus" ? 20.5 : 16.5, COL.ferry);
      el("circle", { cx: p.x, cy: p.y, r: 12.5, "class": "st" }, g);
      var t = el("text", { x: p.x, y: p.y, "class": "stn" }, g);
      t.textContent = i;
    }
    this.dyn = el("g", { "class": "dyn" }, svg);
    this.tokLayer = el("g", { "class": "toks" }, svg);

    function ring(parent, p, r, col) {
      el("circle", { cx: p.x, cy: p.y, r: r, fill: "none", stroke: CASE, "stroke-width": 6.6 }, parent);
      el("circle", { cx: p.x, cy: p.y, r: r, fill: "none", stroke: col, "stroke-width": 3.4 }, parent);
    }
    function label(parent, x, y, text, cls) {
      var half = text.length * 4.6 + 8;
      x = Math.min(Math.max(x, half), b.W - half);
      y = Math.min(Math.max(y, 18), b.H - 10);
      var t = el("text", { x: x, y: y, "class": cls }, parent);
      t.textContent = text;
    }
  };

  MapView.prototype.setBackground = function (url, painted) {
    this.bg.setAttribute("href", url);
    this.labels.setAttribute("visibility", painted ? "visible" : "hidden");
  };

  // ---- view box ----
  MapView.prototype.size = function () {
    var r = this.svg.getBoundingClientRect();
    return { w: r.width || this.c.clientWidth || 360, h: r.height || this.c.clientHeight || 640, left: r.left, top: r.top };
  };
  MapView.prototype.scale = function () { return this.size().w / this.VB.w; };
  MapView.prototype.fitScale = function () {
    var z = this.size();
    return Math.min(z.w / this.b.W, z.h / this.b.H);
  };
  MapView.prototype.apply = function () {
    var z = this.size(), V = this.VB, sc = z.w / V.w;
    V.h = z.h / sc;
    // Keep at least half the screen over the board.
    var mx = Math.max(0, (V.w - this.b.W) / 2), my = Math.max(0, (V.h - this.b.H) / 2);
    V.x = Math.min(Math.max(V.x, -mx - V.w * 0.25), this.b.W - V.w + mx + V.w * 0.25);
    V.y = Math.min(Math.max(V.y, -my - V.h * 0.25), this.b.H - V.h + my + V.h * 0.25);
    this.svg.setAttribute("viewBox", V.x + " " + V.y + " " + V.w + " " + V.h);
    this.svg.style.setProperty("--zoom", sc);
  };
  MapView.prototype.fit = function () {
    var z = this.size(), sc = this.fitScale() * 0.98;
    this.VB = { w: z.w / sc, h: z.h / sc, x: 0, y: 0 };
    this.VB.x = (this.b.W - this.VB.w) / 2;
    this.VB.y = (this.b.H - this.VB.h) / 2;
    this.apply();
  };
  MapView.prototype.resize = function () {
    var cx = this.VB.x + this.VB.w / 2, cy = this.VB.y + this.VB.h / 2;
    this.apply();
    this.VB.x = cx - this.VB.w / 2; this.VB.y = cy - this.VB.h / 2;
    this.apply();
  };
  MapView.prototype.zoomAt = function (ux, uy, factor) {
    var z = this.size(), sc = Math.max(this.fitScale() * 0.9, Math.min(MAX_SCALE, this.scale() * factor));
    var nw = z.w / sc, nh = z.h / sc, V = this.VB;
    V.x = ux - ((ux - V.x) / V.w) * nw;
    V.y = uy - ((uy - V.y) / V.h) * nh;
    V.w = nw; V.h = nh;
    this.apply();
  };
  MapView.prototype.zoomBy = function (f) { this.zoomAt(this.VB.x + this.VB.w / 2, this.VB.y + this.VB.h / 2, f); };
  MapView.prototype.focus = function (n, sc) {
    var z = this.size(), p = this.b.pos[n];
    sc = sc || Math.max(this.scale(), 1);
    this.VB = { w: z.w / sc, h: z.h / sc, x: 0, y: 0 };
    this.VB.x = p.x - this.VB.w / 2; this.VB.y = p.y - this.VB.h / 2;
    this.apply();
  };
  MapView.prototype.toUser = function (cx, cy) {
    var z = this.size();
    return { x: this.VB.x + ((cx - z.left) / z.w) * this.VB.w, y: this.VB.y + ((cy - z.top) / z.h) * this.VB.h };
  };
  // Nearest station to a point, within a 26px board radius (52px target at 1:1) or 22 screen px when zoomed out.
  MapView.prototype.stationAt = function (ux, uy) {
    // Glowing move targets win within ~44 screen px, so a slightly-off tap still picks the move.
    var self = this, sc = this.scale(), pick = 0, pd = Math.max(30, 44 / sc);
    (this.prefer || []).forEach(function (n) {
      var p = self.b.pos[n], d = Math.hypot(p.x - ux, p.y - uy);
      if (d < pd) { pd = d; pick = n; }
    });
    if (pick) return pick;
    var best = 0, bd = Math.max(26, 22 / sc);
    for (var i = 1; i <= this.b.N; i++) {
      var p = this.b.pos[i], d = Math.hypot(p.x - ux, p.y - uy);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };

  MapView.prototype.gestures = function () {
    var self = this, svg = this.svg, ptrs = {}, pinch = null, drag = null;
    svg.addEventListener("pointerdown", function (e) {
      svg.setPointerCapture && svg.setPointerCapture(e.pointerId);
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(ptrs);
      if (ids.length === 1) drag = { x: e.clientX, y: e.clientY, vx: self.VB.x, vy: self.VB.y, moved: 0 };
      if (ids.length === 2) {
        var a = ptrs[ids[0]], b = ptrs[ids[1]];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), sc: self.scale() };
        drag = null;
      }
    });
    svg.addEventListener("pointermove", function (e) {
      if (!ptrs[e.pointerId]) return;
      ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(ptrs);
      if (pinch && ids.length >= 2) {
        var a = ptrs[ids[0]], b = ptrs[ids[1]], mid = self.toUser((a.x + b.x) / 2, (a.y + b.y) / 2);
        var want = pinch.sc * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d);
        self.zoomAt(mid.x, mid.y, want / self.scale());
      } else if (drag) {
        var sc = self.scale(), dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
        self.VB.x = drag.vx - dx / sc; self.VB.y = drag.vy - dy / sc;
        self.apply();
      }
    });
    function up(e) {
      if (drag && drag.moved < 14 && Object.keys(ptrs).length === 1) { // a finger wobbles; up to 14px is still a tap
        var u = self.toUser(e.clientX, e.clientY), n = self.stationAt(u.x, u.y);
        if (n) self.onTap(n);
      }
      delete ptrs[e.pointerId];
      if (Object.keys(ptrs).length < 2) pinch = null;
      if (!Object.keys(ptrs).length) drag = null;
    }
    svg.addEventListener("pointerup", up);
    svg.addEventListener("pointercancel", function (e) { delete ptrs[e.pointerId]; pinch = null; drag = null; });
    svg.addEventListener("wheel", function (e) {
      e.preventDefault();
      var u = self.toUser(e.clientX, e.clientY);
      self.zoomAt(u.x, u.y, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
  };

  // ---- dynamic overlays used by the game ----
  MapView.prototype.clear = function (layer) { while (layer.firstChild) layer.removeChild(layer.firstChild); };
  MapView.prototype.highlight = function (list) {
    // list: [{n, cls}] e.g. legal moves or possible Mr. X stations
    this.clear(this.hiLayer);
    var self = this;
    list.forEach(function (h) {
      var p = self.b.pos[h.n];
      el("circle", { cx: p.x, cy: p.y, r: h.r || 25, "class": "hl " + (h.cls || "") }, self.hiLayer);
    });
  };
  MapView.prototype.showRoutes = function (routes) {
    // routes: [{a, b, t}] drawn as a bright glow (e.g. the selected move)
    this.clear(this.routeHi);
    var self = this;
    routes.forEach(function (r) {
      var geom = self.s.routes.concat(self.s.ferries).filter(function (g) {
        return g.e.t === r.t && ((g.e.a === r.a && g.e.b === r.b) || (g.e.a === r.b && g.e.b === r.a));
      })[0];
      if (geom) el("path", { d: geom.d, "class": "route-glow" }, self.routeHi);
    });
  };
  MapView.prototype.setTokens = function (tokens) {
    // tokens: [{id, n, label, color, ring, text, ghost, halo, tag}]; kept by id so moves glide.
    var self = this, keep = {};
    this.toks = this.toks || {};
    tokens.forEach(function (t) {
      if (!t.n) return;
      keep[t.id] = 1;
      var p = self.b.pos[t.n], key = JSON.stringify([t.label, t.color, t.ring, t.text, t.ghost, t.halo, t.tag]);
      var g = self.toks[t.id];
      if (!g) { g = self.toks[t.id] = el("g", { "class": "tok" }, self.tokLayer); g.setAttribute("transform", "translate(" + p.x + " " + p.y + ")"); }
      if (g._key !== key) {
        self.clear(g); g._key = key;
        g.setAttribute("class", "tok" + (t.ghost ? " ghost" : ""));
        if (t.halo) el("circle", { r: 21, "class": "tokhalo" }, g);
        el("circle", { r: 15, fill: t.color, stroke: t.ring || "#fff", "stroke-width": 3, "stroke-dasharray": t.ghost ? "4 3" : "none" }, g);
        var tx = el("text", { "class": "tokt", fill: t.text || "#fff" }, g);
        if (String(t.label).length > 2) tx.setAttribute("font-size", "9");
        tx.textContent = t.label;
        if (t.tag) {
          var w = String(t.tag).length * 5.6 + 8;
          el("rect", { x: -w / 2, y: 17, width: w, height: 12, rx: 6, "class": "toktagbg" }, g);
          var tg = el("text", { y: 23.5, "class": "toktag" }, g);
          tg.textContent = t.tag;
        }
      }
      g.style.transform = "translate(" + p.x + "px, " + p.y + "px)";
      g.removeAttribute("transform");
      self.tokLayer.appendChild(g); // keep drawing order as given
    });
    Object.keys(this.toks).forEach(function (id) {
      if (!keep[id]) { self.tokLayer.removeChild(self.toks[id]); delete self.toks[id]; }
    });
  };

  FY.MapView = MapView;
  FY.MAP_COLORS = COL;
})(window.FY = window.FY || {});
