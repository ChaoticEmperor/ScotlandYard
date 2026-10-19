/* Fog Yard: static scene geometry shared by the terrain painter and the SVG map.
   Everything is deterministic, so every device paints the identical board. */
(function (FY) {
  "use strict";

  var CELL = 6; // clearance grid resolution in px

  function mulberry(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeNoise(seed) {
    var rnd = mulberry(seed), g = new Float32Array(65536);
    for (var i = 0; i < 65536; i++) g[i] = rnd();
    return function (x, y) {
      var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      var a = g[((yi & 255) << 8) | (xi & 255)], b = g[((yi & 255) << 8) | ((xi + 1) & 255)];
      var c = g[(((yi + 1) & 255) << 8) | (xi & 255)], d = g[(((yi + 1) & 255) << 8) | ((xi + 1) & 255)];
      var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
  }
  function fbm(n, x, y, o) {
    var a = 0, amp = 0.5, f = 1, s = 0;
    for (var i = 0; i < o; i++) { a += amp * n(x * f, y * f); s += amp; amp *= 0.5; f *= 2; }
    return a / s;
  }
  function segDist(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    var qx = ax + t * dx - px, qy = ay + t * dy - py;
    return Math.sqrt(qx * qx + qy * qy);
  }
  function segHit(p1, p2, p3, p4) {
    var d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
    if (!d) return null;
    var t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
    var u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])] : null;
  }

  function Grid(W, H) {
    this.w = Math.ceil(W / CELL) + 1; this.h = Math.ceil(H / CELL) + 1;
    this.v = new Float32Array(this.w * this.h).fill(1e4);
  }
  Grid.prototype.at = function (x, y) {
    var i = Math.round(x / CELL), j = Math.round(y / CELL);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return 1e4;
    return this.v[j * this.w + i];
  };
  Grid.prototype.stampSeg = function (ax, ay, bx, by, R) {
    var i0 = Math.max(0, Math.floor((Math.min(ax, bx) - R) / CELL)), i1 = Math.min(this.w - 1, Math.ceil((Math.max(ax, bx) + R) / CELL));
    var j0 = Math.max(0, Math.floor((Math.min(ay, by) - R) / CELL)), j1 = Math.min(this.h - 1, Math.ceil((Math.max(ay, by) + R) / CELL));
    for (var j = j0; j <= j1; j++)
      for (var i = i0; i <= i1; i++) {
        var d = segDist(i * CELL, j * CELL, ax, ay, bx, by), k = j * this.w + i;
        if (d < this.v[k]) this.v[k] = d;
      }
  };
  Grid.prototype.stampLine = function (pts, R) {
    for (var k = 0; k < pts.length - 1; k++) this.stampSeg(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], R);
  };

  // Bus and underground routes bow out to opposite sides so they don't hide taxi roads.
  function routeGeom(board, e) {
    var A = board.pos[e.a], B = board.pos[e.b], dx = B.x - A.x, dy = B.y - A.y, len = Math.sqrt(dx * dx + dy * dy);
    var off = e.t === "bus" ? Math.min(34, 0.13 * len + 6) : e.t === "underground" ? -Math.min(70, 0.2 * len + 8) : 0;
    var cx = (A.x + B.x) / 2 + (-dy / len) * off, cy = (A.y + B.y) / 2 + (dx / len) * off;
    var pts = [];
    var n = off ? 14 : 1;
    for (var i = 0; i <= n; i++) {
      var t = i / n, u = 1 - t;
      pts.push([u * u * A.x + 2 * u * t * cx + t * t * B.x, u * u * A.y + 2 * u * t * cy + t * t * B.y]);
    }
    var r1 = function (v) { return Math.round(v * 10) / 10; };
    var d = off ? "M" + A.x + " " + A.y + "Q" + r1(cx) + " " + r1(cy) + " " + B.x + " " + B.y : "M" + A.x + " " + A.y + "L" + B.x + " " + B.y;
    return { e: e, d: d, pts: pts };
  }

  function chaikin(pts, iters) {
    for (var it = 0; it < iters; it++) {
      var q = [pts[0]];
      for (var i = 0; i < pts.length - 1; i++) {
        var a = pts[i], b = pts[i + 1];
        q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      q.push(pts[pts.length - 1]);
      pts = q;
    }
    return pts;
  }

  // Least-cost grid path (8-neighbour Dijkstra with a binary heap).
  function gridPath(cost, gw, gh, from, to) {
    var N = gw * gh, dist = new Float32Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
    var heap = [], s = from[1] * gw + from[0], goal = to[1] * gw + to[0];
    function push(k, d) {
      heap.push([d, k]);
      for (var i = heap.length - 1; i > 0;) {
        var p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        var t = heap[p]; heap[p] = heap[i]; heap[i] = t; i = p;
      }
    }
    function pop() {
      var top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        for (var i = 0; ;) {
          var l = 2 * i + 1, r = l + 1, m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          var t = heap[m]; heap[m] = heap[i]; heap[i] = t; i = m;
        }
      }
      return top;
    }
    dist[s] = 0; push(s, 0);
    var DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    while (heap.length) {
      var top = pop(), k = top[1];
      if (top[0] > dist[k]) continue;
      if (k === goal) break;
      var x = k % gw, y = (k / gw) | 0;
      for (var di = 0; di < 8; di++) {
        var nx = x + DIRS[di][0], ny = y + DIRS[di][1];
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        var nk = ny * gw + nx, nd = dist[k] + DIRS[di][2] * (cost[k] + cost[nk]) * 0.5;
        if (nd < dist[nk]) { dist[nk] = nd; prev[nk] = k; push(nk, nd); }
      }
    }
    var path = [];
    for (var c = goal; c >= 0; c = prev[c]) path.push([(c % gw) * CELL, ((c / gw) | 0) * CELL]);
    return path.reverse();
  }

  // Bus links follow the taxi roads between their stops, each on its own side of the road
  // (like bus lanes). Long detours or roads with both sides taken fall back to a curve.
  var LANE = 3.6;
  function busAlongRoads(board) {
    var N = board.N, pos = board.pos, taxi = board.adj.taxi;
    var len = function (a, b) { return Math.hypot(pos[a].x - pos[b].x, pos[a].y - pos[b].y); };
    var segKey = function (a, b) { return a < b ? a + "-" + b : b + "-" + a; };
    var used = {}; // segKey -> {"1": true, "-1": true} sides taken (relative to min->max direction)
    function path(a, b) {
      var d = new Float64Array(N + 1).fill(Infinity), prev = new Int32Array(N + 1).fill(-1), done = new Uint8Array(N + 1);
      d[a] = 0;
      for (;;) {
        var u = -1;
        for (var i = 1; i <= N; i++) if (!done[i] && d[i] < Infinity && (u < 0 || d[i] < d[u])) u = i;
        if (u < 0 || u === b) break;
        done[u] = 1;
        taxi[u].forEach(function (v) { var nd = d[u] + len(u, v); if (nd < d[v]) { d[v] = nd; prev[v] = u; } });
      }
      if (d[b] === Infinity) return null;
      var out = [];
      for (var c = b; c >= 0; c = prev[c]) out.push(c);
      return { stops: out.reverse(), length: d[b] };
    }
    var bus = board.edges.filter(function (e) { return e.t === "bus"; }).map(function (e) {
      return { e: e, p: path(e.a, e.b), direct: len(e.a, e.b) };
    });
    bus.sort(function (x, y) { return (x.p ? x.p.length : 1e9) - (y.p ? y.p.length : 1e9); });
    return bus.map(function (b) {
      var ok = b.p && b.p.length <= 1.7 * b.direct + 20 && b.p.stops.length <= 6;
      var sides = null;
      if (ok) {
        // Prefer one side for the whole journey; otherwise any free side per road.
        var st = b.p.stops, pick = function (pref) {
          var res = [];
          for (var k = 0; k < st.length - 1; k++) {
            var u = st[k], v = st[k + 1], dir = u < v ? 1 : -1, key = segKey(u, v), taken = used[key] || {};
            var want = pref * dir;
            if (!taken[want]) res.push(want);
            else if (pref === 0 && !taken[-want]) res.push(-want);
            else if (pref === 0) return null;
            else return null;
          }
          return res;
        };
        sides = pick(1) || pick(-1) || pick(0);
      }
      if (!sides) return routeGeom(board, b.e);
      var pts = [], st2 = b.p.stops;
      for (var k = 0; k < st2.length - 1; k++) {
        var u = st2[k], v = st2[k + 1], key = segKey(u, v);
        (used[key] = used[key] || {})[sides[k]] = true;
        var lo = Math.min(u, v), hi = Math.max(u, v), dx = pos[hi].x - pos[lo].x, dy = pos[hi].y - pos[lo].y, l = Math.hypot(dx, dy);
        var ox = (-dy / l) * LANE * sides[k], oy = (dx / l) * LANE * sides[k];
        pts.push([pos[u].x + ox, pos[u].y + oy], [pos[v].x + ox, pos[v].y + oy]);
      }
      var d = "M" + pts.map(function (q) { return q[0].toFixed(1) + " " + q[1].toFixed(1); }).join("L");
      return { e: b.e, d: d, pts: pts, lanes: true, via: st2 };
    });
  }

  var NAMES = {
    mountain: ["Greyfell", "Frostspire", "Ravenpeak", "Highmoor Crags", "Whitecap", "Stormridge"],
    lake: ["Mirror Mere", "Stillwater", "Glassmere"],
    grove: ["Pinewood", "Elderholt", "Fernwood", "Mossdeep", "Larchwood", "Brackenhurst", "Thornwood", "Hollins"]
  };

  function compose(board) {
    var W = board.W, H = board.H, N = board.N, i, j, k;
    var routes = board.edges.filter(function (e) { return e.t !== "ferry"; }).map(function (e) {
      return e.t === "bus" ? null : routeGeom(board, e);
    });
    routes = routes.filter(Boolean).concat(busAlongRoads(board));

    // Clearance grids: to stations (all / non-pier) and to drawn routes.
    var piers = {};
    board.edges.forEach(function (e) { if (e.t === "ferry") { piers[e.a] = 1; piers[e.b] = 1; } });
    var gSt = new Grid(W, H), gStNP = new Grid(W, H), gRt = new Grid(W, H);
    for (i = 1; i <= N; i++) {
      var p = board.pos[i];
      gSt.stampSeg(p.x, p.y, p.x, p.y, 160);
      if (!piers[i]) gStNP.stampSeg(p.x, p.y, p.x, p.y, 60);
    }
    routes.forEach(function (r) { gRt.stampLine(r.pts, 140); });

    var chain = ferryChain(board), river, riverW, sections, gw = gSt.w, gh = gSt.h;
    if (board.river) {
      // Real river (London map): the fitted Thames centreline; ferries run along it between piers.
      river = chaikin(board.river.line, 2);
      var rw = board.river.width;
      riverW = function () { return rw; };
      var nearestIdx = function (p) {
        var bi = 0, bd = Infinity;
        river.forEach(function (q, n) { var d = Math.hypot(q[0] - p.x, q[1] - p.y); if (d < bd) { bd = d; bi = n; } });
        return bi;
      };
      sections = [null];
      for (k = 0; k < chain.length - 1; k++) {
        var pa = board.pos[chain[k]], pb = board.pos[chain[k + 1]], ia = nearestIdx(pa), ib = nearestIdx(pb);
        var seg = ia <= ib ? river.slice(ia, ib + 1) : river.slice(ib, ia + 1).reverse();
        sections.push([[pa.x, pa.y]].concat(seg, [[pb.x, pb.y]]));
      }
    } else {
      var made = proceduralRiver();
      river = made.river; riverW = made.riverW; sections = made.sections;
    }

    // Ferry routes follow the river between consecutive piers.
    var ferries = [];
    for (k = 0; k < chain.length - 1; k++) {
      var sec = sections[k + 1];
      ferries.push({ e: { a: chain[k], b: chain[k + 1], t: "ferry" }, pts: sec, d: "M" + sec.map(function (q) { return q[0].toFixed(1) + " " + q[1].toFixed(1); }).join("L") });
    }

    // Fallback river: least-cost path through the ferry piers, steering around other stations.
    function proceduralRiver() {
      var nz = makeNoise(77), cost = new Float32Array(gw * gh);
      for (j = 0; j < gh; j++)
        for (i = 0; i < gw; i++) {
          k = j * gw + i;
          var ds = gStNP.v[k], dr = gRt.v[k];
          cost[k] = 1 + 60 * Math.pow(Math.max(0, 1 - ds / 40), 2) + (dr < 9 ? 1.5 : 0) + 2.2 * fbm(nz, i * 0.12, j * 0.12, 2);
        }
      var cellOf = function (x, y) { return [Math.max(0, Math.min(gw - 1, Math.round(x / CELL))), Math.max(0, Math.min(gh - 1, Math.round(y / CELL)))]; };
      var edgePoint = function (from, toward) {
        var dx = from.x - toward.x, dy = from.y - toward.y, l = Math.hypot(dx, dy), t = Infinity;
        dx /= l; dy /= l;
        if (dx > 0) t = Math.min(t, (W - from.x) / dx); if (dx < 0) t = Math.min(t, -from.x / dx);
        if (dy > 0) t = Math.min(t, (H - from.y) / dy); if (dy < 0) t = Math.min(t, -from.y / dy);
        return { x: from.x + dx * t, y: from.y + dy * t };
      };
      var first = board.pos[chain[0]], last = board.pos[chain[chain.length - 1]];
      var anchors = [edgePoint(first, board.pos[chain[1]])].concat(chain.map(function (s) { return board.pos[s]; }), [edgePoint(last, board.pos[chain[chain.length - 2]])]);
      var sections = [], i, k;
      for (k = 0; k < anchors.length - 1; k++) {
        var a = anchors[k], b = anchors[k + 1];
        var cells = gridPath(cost, gw, gh, cellOf(a.x, a.y), cellOf(b.x, b.y));
        var pts = [[a.x, a.y]];
        for (i = 2; i < cells.length - 2; i += 3) pts.push(cells[i]);
        pts.push([b.x, b.y]);
        sections.push(chaikin(pts, 3));
      }
      var river = [];
      sections.forEach(function (s, idx) { river = river.concat(idx ? s.slice(1) : s); });
      // Make the off-board ends run past the edge so the river doesn't stop at the frame.
      var ext = function (p, q) { return [p[0] + (p[0] - q[0]) * 6, p[1] + (p[1] - q[1]) * 6]; };
      river.unshift(ext(river[0], river[1]));
      river.push(ext(river[river.length - 1], river[river.length - 2]));
      var riverW = function (t) { return 13 + 13 * t; }; // narrow at the source, wide at the mouth
      return { river: river, riverW: riverW, sections: sections };
    }

    var gRv = new Grid(W, H);
    gRv.stampLine(river, 160);

    // Bridges where roads (taxi and bus) cross the river, away from the piers themselves.
    var bridges = [];
    routes.forEach(function (r) {
      if (r.e.t === "underground") return;
      for (var s = 0; s < r.pts.length - 1; s++)
        for (var q = 0; q < river.length - 1; q++) {
          var hit = segHit(r.pts[s], r.pts[s + 1], river[q], river[q + 1]);
          if (!hit || gSt.at(hit[0], hit[1]) < 18) continue;
          if (r.e.t === "bus" && r.lanes) continue; // bus lanes ride on the taxi road's bridge
          bridges.push({
            x: hit[0], y: hit[1], type: r.e.t, w: riverW(q / (river.length - 1)),
            angle: Math.atan2(r.pts[s + 1][1] - r.pts[s][1], r.pts[s + 1][0] - r.pts[s][0])
          });
        }
    });

    // Free space: discs far from stations, routes, the river and (for lakes) the frame.
    var free = new Float32Array(gw * gh), cand = [];
    for (j = 0; j < gh; j++)
      for (i = 0; i < gw; i++) {
        k = j * gw + i;
        var f = Math.min(gSt.v[k] - 16, gRt.v[k] - 6, gRv.v[k] - 26);
        free[k] = f;
        if (f >= 22) cand.push(k);
      }
    cand.sort(function (x, y) { return free[y] - free[x]; });
    var discs = [];
    for (var c = 0; c < cand.length && discs.length < 34; c++) {
      var cx = (cand[c] % gw) * CELL, cy = ((cand[c] / gw) | 0) * CELL, r = Math.min(free[cand[c]], 120);
      if (discs.every(function (d) { return Math.hypot(d.x - cx, d.y - cy) > d.r + r + 8; })) discs.push({ x: cx, y: cy, r: r });
    }
    var border = function (d) { return Math.min(d.x, d.y, W - d.x, H - d.y); };
    var features = { mountains: [], lakes: [], groves: [] };
    discs.forEach(function (d) {
      var edge = border(d) < d.r * 0.7;
      if (d.r >= 34 && (edge || (d.y < H * 0.3 && d.r >= 44))) d.kind = "mountain";
      else if (d.r >= 38 && border(d) > d.r + 6 && features.lakes.length < 3) d.kind = "lake";
      else d.kind = "grove";
      features[d.kind === "mountain" ? "mountains" : d.kind === "lake" ? "lakes" : "groves"].push(d);
    });
    if (!features.lakes.length && features.groves.length) {
      var big = features.groves.reduce(function (m, d) { return d.r > m.r ? d : m; });
      features.groves.splice(features.groves.indexOf(big), 1);
      big.kind = "lake";
      features.lakes.push(big);
    }
    Object.keys(features).forEach(function (key) {
      var pool = NAMES[key === "mountains" ? "mountain" : key === "lakes" ? "lake" : "grove"];
      features[key].sort(function (x, y) { return y.r - x.r; });
      features[key].forEach(function (d, n) { d.name = n < pool.length && d.r >= (key === "groves" ? 24 : 36) ? pool[n] : null; });
    });

    return {
      W: W, H: H, routes: routes, ferries: ferries, river: river, riverW: riverW, bridges: bridges,
      features: features, grids: { st: gSt, rt: gRt, rv: gRv }, piers: piers,
      util: { mulberry: mulberry, makeNoise: makeNoise, fbm: fbm, segDist: segDist }
    };
  }

  // Ferry stations ordered along their chain (a simple path).
  function ferryChain(board) {
    var deg = {}, nb = {};
    board.edges.forEach(function (e) {
      if (e.t !== "ferry") return;
      [[e.a, e.b], [e.b, e.a]].forEach(function (p) { deg[p[0]] = (deg[p[0]] || 0) + 1; (nb[p[0]] = nb[p[0]] || []).push(p[1]); });
    });
    var ends = Object.keys(deg).filter(function (s) { return deg[s] === 1; }).map(Number);
    var start = Math.max.apply(null, ends.length ? ends : [Number(Object.keys(deg)[0])]);
    var out = [start], seen = {};
    seen[start] = 1;
    for (var cur = start; ;) {
      var nx = (nb[cur] || []).filter(function (s) { return !seen[s]; })[0];
      if (nx === undefined) break;
      out.push(nx); seen[nx] = 1; cur = nx;
    }
    return out;
  }

  FY.Scene = { compose: compose };
})(window.FY = window.FY || {});
