/* Shadow Line: board background. Uses assets/map.jpg when present, otherwise paints a
   procedural diorama (rolling hills, forests, snowy peaks, lakes and a river; bridges are drawn by the map view). */
(function (FY) {
  "use strict";

  function tri(ctx, x1, y1, x2, y2, x3, y3) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.closePath(); ctx.fill();
  }
  function blobPath(ctx, cx, cy, r, rnd) {
    var n = 48, off = [], i;
    for (i = 0; i < n; i++) off.push(rnd());
    ctx.beginPath();
    for (i = 0; i <= n; i++) {
      var k = i % n, a = (k / n) * Math.PI * 2, s = off[k] * 0.5 + off[(k + 1) % n] * 0.5, rr = r * (0.84 + 0.3 * s);
      var x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.86;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  function drawConifer(ctx, x, y, s, snow) {
    var h = 17 * s, w = 8.5 * s;
    ctx.fillStyle = "rgba(8,40,20,.26)";
    ctx.beginPath(); ctx.ellipse(x + w * 0.55, y + 0.5, w * 0.85, w * 0.26, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = "#5a3d26"; ctx.fillRect(x - 0.7 * s, y - 2.4 * s, 1.4 * s, 2.6 * s);
    for (var i = 0; i < 3; i++) {
      var ty = y - 2.2 * s - i * h * 0.27, tw = w * (1 - i * 0.22), th = h * 0.5;
      ctx.fillStyle = "#24573f"; tri(ctx, x, ty - th, x - tw / 2, ty, x + tw / 2, ty);
      ctx.fillStyle = "#3a8761"; tri(ctx, x, ty - th, x - tw / 2, ty, x + tw * 0.04, ty);
      if (snow) { ctx.fillStyle = "rgba(250,252,255,.9)"; tri(ctx, x, ty - th, x - tw * 0.18, ty - th * 0.62, x + tw * 0.18, ty - th * 0.62); }
    }
  }
  function drawBroad(ctx, x, y, s, pal) {
    var r = 5.6 * s;
    ctx.fillStyle = "rgba(8,40,20,.24)";
    ctx.beginPath(); ctx.ellipse(x + r * 0.6, y + 0.5, r * 1.1, r * 0.34, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = "#5a3d26"; ctx.fillRect(x - 0.8 * s, y - 3.2 * s, 1.6 * s, 3.4 * s);
    ctx.fillStyle = pal[0];
    [[-0.5, -1.7, 0.8], [0.5, -1.8, 0.8], [0, -2.45, 0.92], [0, -1.4, 0.9]].forEach(function (c) { ctx.beginPath(); ctx.arc(x + c[0] * r, y + c[1] * r, c[2] * r, 0, 6.283); ctx.fill(); });
    ctx.fillStyle = pal[1];
    [[-0.62, -1.95, 0.5], [0.1, -2.65, 0.55], [-0.2, -1.5, 0.45]].forEach(function (c) { ctx.beginPath(); ctx.arc(x + c[0] * r, y + c[1] * r, c[2] * r, 0, 6.283); ctx.fill(); });
  }
  function drawPeak(ctx, cx, by, w, h, rnd) {
    var px = cx + (rnd() - 0.5) * w * 0.14, py = by - h;
    var A = [cx - w / 2, by], B = [cx + w / 2, by];
    function ridge(f, t, n) {
      var p = [];
      for (var i = 1; i < n; i++) { var k = i / n; p.push([f[0] + (t[0] - f[0]) * k + (rnd() - 0.5) * w * 0.07, f[1] + (t[1] - f[1]) * k + (rnd() - 0.5) * h * 0.07]); }
      return p;
    }
    var Lr = ridge(A, [px, py], 5), Rr = ridge([px, py], B, 5);
    function path() {
      ctx.beginPath(); ctx.moveTo(A[0], A[1]);
      Lr.forEach(function (p) { ctx.lineTo(p[0], p[1]); });
      ctx.lineTo(px, py);
      Rr.forEach(function (p) { ctx.lineTo(p[0], p[1]); });
      ctx.lineTo(B[0], B[1]); ctx.closePath();
    }
    ctx.fillStyle = "rgba(30,60,30,.32)";
    ctx.beginPath(); ctx.ellipse(cx + w * 0.08, by + 2, w * 0.6, h * 0.12, 0, 0, 6.283); ctx.fill();
    ctx.save(); path(); ctx.clip();
    var gl = ctx.createLinearGradient(0, py, 0, by);
    gl.addColorStop(0, "#cfc3ad"); gl.addColorStop(0.55, "#9c876c"); gl.addColorStop(1, "#6f6a4a");
    ctx.fillStyle = gl; ctx.fillRect(cx - w, py - 6, w * 2, h + 12);
    var y0 = py + h * 0.46;
    ctx.fillStyle = "#f6f8fc";
    ctx.beginPath(); ctx.moveTo(cx - w, py - 8); ctx.lineTo(cx + w, py - 8);
    for (var x = cx + w; x >= cx - w; x -= w / 12) ctx.lineTo(x, y0 + (rnd() - 0.5) * h * 0.18 + Math.abs(x - px) * 0.5);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(70,52,38,.26)"; ctx.lineWidth = 1;
    for (var i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(px + (rnd() - 0.5) * w * 0.08, py + h * 0.08); ctx.lineTo(cx + (rnd() - 0.5) * w * 0.9, by); ctx.stroke(); }
    // Shadowed east face gives the diorama its low-sun depth.
    ctx.fillStyle = "rgba(38,46,80,.38)";
    ctx.beginPath(); ctx.moveTo(px, py - 8); ctx.lineTo(px + w * 0.06, by + 2); ctx.lineTo(B[0] + 6, B[1] + 2); ctx.lineTo(px + w, py - 10); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = "rgba(60,45,35,.42)"; ctx.lineWidth = 1; path(); ctx.stroke();
  }
  function drawRange(ctx, d, rnd) {
    var peaks = [
      { dx: -0.55, s: 0.62 }, { dx: 0.58, s: 0.66 }, { dx: 0, s: 1 }
    ];
    peaks.forEach(function (p) {
      var w = d.r * 1.25 * p.s + 10, h = d.r * 1.2 * p.s + 8;
      drawPeak(ctx, d.x + p.dx * d.r, d.y + d.r * 0.45 + (1 - p.s) * d.r * 0.2, w, h, rnd);
    });
  }

  function paint(scene, opts) {
    opts = opts || {};
    var U = scene.util, W = scene.W, H = scene.H, SC = opts.scale || 2;
    var cv = document.createElement("canvas");
    cv.width = Math.round(W * SC); cv.height = Math.round(H * SC);
    var ctx = cv.getContext("2d");
    var n1 = U.makeNoise(31), n2 = U.makeNoise(57), n3 = U.makeNoise(91);
    var G = scene.grids, F = scene.features, x, y, i;

    function inDisc(list, px, py, pad) {
      for (var k = 0; k < list.length; k++) if (Math.hypot(px - list[k].x, (py - list[k].y) / 0.86) < list[k].r + pad) return list[k];
      return null;
    }
    function forest(px, py) {
      var m = U.fbm(n2, px * 0.011, py * 0.011, 3);
      if (inDisc(F.groves, px, py, 0)) m += 0.35;
      if (inDisc(F.mountains, px, py, 30)) m += 0.12;
      return m;
    }

    // 1) Rolling hills: a height field with hill shading, lifted towards the mountains.
    var hc = document.createElement("canvas");
    hc.width = W; hc.height = H;
    var hx = hc.getContext("2d"), img = hx.createImageData(W, H), dat = img.data, Hf = new Float32Array(W * H);
    for (y = 0; y < H; y++)
      for (x = 0; x < W; x++) {
        var lift = 0;
        for (i = 0; i < F.mountains.length; i++) {
          var m = F.mountains[i], dd = Math.hypot(x - m.x, y - m.y) / (m.r * 2.2);
          if (dd < 1) lift += 0.35 * (1 - dd) * (1 - dd);
        }
        Hf[y * W + x] = U.fbm(n1, x * 0.006, y * 0.006, 3) * 0.8 + U.fbm(n3, x * 0.025, y * 0.025, 2) * 0.2 + lift;
      }
    for (y = 0; y < H; y++)
      for (x = 0; x < W; x++) {
        var k = y * W + x;
        var sh = ((Hf[y * W + Math.max(0, x - 1)] - Hf[y * W + Math.min(W - 1, x + 1)]) + (Hf[Math.max(0, y - 1) * W + x] - Hf[Math.min(H - 1, y + 1) * W + x])) * 10;
        sh = Math.max(-0.24, Math.min(0.24, sh));
        var t = Math.min(1, Math.max(0, (Hf[k] - 0.3) / 0.45)), fm = Math.max(0, Math.min(1, (forest(x, y) - 0.5) * 2));
        var mul = (1 + sh) * (1 - 0.14 * fm), gr = (n3(x * 0.9, y * 0.9) - 0.5) * 12;
        dat[k * 4] = Math.max(0, Math.min(255, (84 + 96 * t) * mul + gr));
        dat[k * 4 + 1] = Math.max(0, Math.min(255, (158 + 48 * t) * mul + gr));
        dat[k * 4 + 2] = Math.max(0, Math.min(255, (54 + 46 * t) * mul + gr * 0.6));
        dat[k * 4 + 3] = 255;
      }
    hx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(hc, 0, 0, cv.width, cv.height);
    ctx.save();
    ctx.scale(SC, SC);

    // 2) Lakes with sandy shores.
    var lr = U.mulberry(12);
    F.lakes.forEach(function (l) {
      var rnd = U.mulberry(Math.round(l.x * 7 + l.y));
      blobPath(ctx, l.x, l.y, l.r * 0.92 + 8, rnd); ctx.fillStyle = "#e2c78e"; ctx.fill();
      rnd = U.mulberry(Math.round(l.x * 7 + l.y));
      blobPath(ctx, l.x, l.y, l.r * 0.92, rnd);
      var g = ctx.createLinearGradient(l.x - l.r, l.y - l.r, l.x + l.r, l.y + l.r);
      g.addColorStop(0, "#7fcbec"); g.addColorStop(1, "#3a93cb");
      ctx.fillStyle = g; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.stroke();
      for (var w = 0; w < 4; w++) {
        var wx = l.x + (lr() - 0.5) * l.r, wy = l.y + (lr() - 0.5) * l.r * 0.7;
        ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(wx - 8, wy); ctx.quadraticCurveTo(wx, wy - 3, wx + 8, wy); ctx.stroke();
      }
    });

    // 3) River: sandy banks, water, a bright current line.
    var rp = scene.river;
    function strokeRiver(extra, col, alpha, mulW) {
      ctx.strokeStyle = col; ctx.globalAlpha = alpha; ctx.lineCap = "round"; ctx.lineJoin = "round";
      for (var s = 0; s < rp.length - 1; s++) {
        ctx.lineWidth = scene.riverW(s / (rp.length - 1)) * mulW + extra;
        ctx.beginPath(); ctx.moveTo(rp[s][0], rp[s][1]); ctx.lineTo(rp[s + 1][0], rp[s + 1][1]); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    strokeRiver(10, "#d9c28b", 0.8, 1);
    strokeRiver(0, "#3f9bd2", 1, 1);
    strokeRiver(0, "#73bfe6", 0.8, 0.6);
    strokeRiver(0, "#bfe6f7", 0.55, 0.18);

    // 5) Snowy mountain ranges.
    F.mountains.forEach(function (d) { drawRange(ctx, d, U.mulberry(Math.round(d.x * 3 + d.y * 5))); });

    // 6) Trees, kept off stations, routes, water and peaks.
    var rnd = U.mulberry(404), trees = [], tries = Math.round((W * H) / 62);
    for (i = 0; i < tries; i++) {
      var tx = rnd() * W, ty = rnd() * H, fm2 = forest(tx, ty), p = fm2 > 0.55 ? 0.95 : fm2 > 0.48 ? 0.25 : 0.03;
      var roll = rnd(), pick = rnd(), sz = 0.8 + rnd() * 0.5, pal = rnd();
      if (roll > p) continue;
      if (G.st.at(tx, ty) < 24 || G.rt.at(tx, ty) < 9 || G.rv.at(tx, ty) < 22) continue;
      if (inDisc(F.lakes, tx, ty, 10)) continue;
      var md = inDisc(F.mountains, tx, ty, 4);
      if (md && ty < md.y + md.r * 0.5) continue;
      trees.push({ x: tx, y: ty, s: sz, c: pick < 0.62 || md ? 0 : 1, p: pal, snow: !!md || (ty < H * 0.2 && pal > 0.6) });
    }
    trees.sort(function (a, b) { return a.y - b.y; });
    var PALS = [["#2f7d58", "#4fa376"], ["#6f9a3a", "#9cc455"], ["#4c9a3c", "#7bc152"]], AUT = [["#d4a92f", "#ecd05a"], ["#cf7a29", "#eba04f"]];
    trees.forEach(function (t) {
      if (t.c === 0) drawConifer(ctx, t.x, t.y, t.s, t.snow);
      else if (t.p > 0.94) drawBroad(ctx, t.x, t.y, t.s, AUT[t.p > 0.97 ? 1 : 0]);
      else drawBroad(ctx, t.x, t.y, t.s, PALS[Math.floor(t.p * 3) % 3]);
    });
    ctx.restore();

    // 7) Soft vignette for a tabletop-diorama feel.
    var vg = ctx.createRadialGradient(cv.width / 2, cv.height / 2, Math.min(cv.width, cv.height) * 0.3, cv.width / 2, cv.height / 2, Math.max(cv.width, cv.height) * 0.72);
    vg.addColorStop(0, "rgba(10,30,10,0)"); vg.addColorStop(1, "rgba(10,30,10,.3)");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, cv.width, cv.height);
    return cv;
  }

  // Resolves to an image URL: assets/map.jpg if it loads, otherwise a freshly painted canvas.
  function background(scene, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var done = function () {
        var cv = paint(scene, opts);
        if (cv.toBlob) cv.toBlob(function (b) { resolve({ url: b ? URL.createObjectURL(b) : cv.toDataURL("image/jpeg", 0.9), painted: true }); }, "image/jpeg", 0.9);
        else resolve({ url: cv.toDataURL("image/jpeg", 0.9), painted: true });
      };
      if (opts.image === false) return done();
      var im = new Image();
      im.onload = function () { resolve({ url: im.src, painted: false }); };
      im.onerror = done;
      im.src = opts.image || "assets/map.jpg";
    });
  }

  FY.Terrain = { paint: paint, background: background };
})(window.FY = window.FY || {});
