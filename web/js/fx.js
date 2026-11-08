/* Find Mr. X interaction animations, built on Motion (motion.dev, pinned on jsDelivr) and
   canvas-confetti. Both load deferred; until they arrive, or if they can't, the CSS animations
   in app.css stand in. Nothing here runs with the reduced-motion setting. */
(function (FY) {
  "use strict";
  var reduceQ = window.matchMedia("(prefers-reduced-motion: reduce)");
  function M() { return !reduceQ.matches && window.Motion && window.Motion.animate ? window.Motion : null; }
  var SPRING_IN = { type: "spring", stiffness: 700, damping: 32 };
  var SPRING_OUT = { type: "spring", stiffness: 420, damping: 13 };

  // With Motion loaded, presses spring instead of using the CSS :active dip.
  function flagMotion() { if (M()) document.documentElement.classList.add("has-motion"); }
  window.addEventListener("load", flagMotion);
  reduceQ.addEventListener && reduceQ.addEventListener("change", function () { document.documentElement.classList.toggle("has-motion", !!M()); });

  // ---------- springy presses ----------
  var PRESS = ".btn, .role, button.chip, .mv, .mv .tkb button, .seg button, #tabs button, .ib, .zoom button";
  var pressed = null;
  document.addEventListener("pointerdown", function (e) {
    var m = M(), el = e.target.closest && e.target.closest(PRESS);
    if (!m || !el || el.disabled) return;
    // A button inside a move card springs on its own; the card dips with it a little.
    pressed = el;
    m.animate(el, { scale: el.classList.contains("mv") ? 0.98 : 0.93 }, SPRING_IN);
  }, { passive: true });
  function release() {
    var m = M();
    if (pressed && m) m.animate(pressed, { scale: 1 }, SPRING_OUT);
    pressed = null;
  }
  document.addEventListener("pointerup", release, { passive: true });
  document.addEventListener("pointercancel", release, { passive: true });

  // ---------- ticket counts that tick ----------
  // Elements marked data-ct="key" hold a number; when it changes between redraws it counts
  // from the old value to the new one and bumps (red when spent, green when received).
  var counts = {};
  function counters(root) {
    var m = M();
    root.querySelectorAll("[data-ct]").forEach(function (el) {
      var k = el.getAttribute("data-ct"), v = +el.textContent, old = counts[k];
      counts[k] = v;
      if (!m || old == null || old === v || isNaN(old)) return;
      el.textContent = old;
      m.animate(old, v, { duration: 0.5, ease: "easeOut", onUpdate: function (x) { el.textContent = Math.round(x); } });
      el.classList.remove("up", "down");
      void el.offsetWidth;
      el.classList.add(v < old ? "down" : "up");
      m.animate(el, { scale: [1, 1.5, 1] }, { duration: 0.45, ease: "easeOut" });
    });
  }

  // ---------- travel log entries flip in ----------
  var filled = null;
  function travel(root) {
    var m = M(), cells = root.querySelectorAll(".lc"), n = 0;
    cells.forEach(function (c) { if (!c.querySelector(".tk.e")) n++; });
    if (m && filled != null && n > filled) {
      for (var i = filled; i < n; i++) {
        var c = cells[i], tk = c.querySelector(".tk");
        if (tk) m.animate(tk, { rotateY: [100, 0], scale: [0.5, 1] }, { type: "spring", stiffness: 320, damping: 15, delay: (i - filled) * 0.15 });
        if (c.classList.contains("rev")) {
          c.classList.remove("glow");
          void c.offsetWidth;
          c.classList.add("glow");
        }
      }
    }
    filled = n;
  }

  // ---------- segmented switches slide their highlight ----------
  // The highlight glides from the old choice to the new one. Positions are remembered per switch,
  // so this also works when the whole lobby is redrawn.
  var segAt = {};
  function segs(root) {
    var m = M();
    root.querySelectorAll(".seg").forEach(function (s, idx) {
      var on = s.querySelector('[aria-checked="true"]');
      if (!on) return;
      var pid = s.querySelector("[data-pid]"), key = (s.id || (pid ? pid.getAttribute("data-pid") : "")) + ":" + idx;
      var r = { x: on.offsetLeft, y: on.offsetTop, w: on.offsetWidth, h: on.offsetHeight }, prev = segAt[key];
      segAt[key] = r;
      if (!m || !prev || (prev.x === r.x && prev.y === r.y && prev.w === r.w)) return;
      var pill = document.createElement("span");
      pill.className = "segpill";
      s.classList.add("sliding");
      s.appendChild(pill);
      m.animate(pill, { left: [prev.x + "px", r.x + "px"], top: [prev.y + "px", r.y + "px"], width: [prev.w + "px", r.w + "px"], height: [prev.h + "px", r.h + "px"] },
        { type: "spring", stiffness: 500, damping: 34 }).then(function () { pill.remove(); s.classList.remove("sliding"); });
    });
  }

  // ---------- confetti for the winners ----------
  function celebrate(colors) {
    if (reduceQ.matches || typeof window.confetti !== "function") return;
    var c = window.confetti, opts = { colors: colors, disableForReducedMotion: true, zIndex: 50, ticks: 220 };
    c(Object.assign({ particleCount: 110, spread: 80, startVelocity: 42, origin: { y: 0.62 } }, opts));
    setTimeout(function () { c(Object.assign({ particleCount: 60, angle: 60, spread: 58, origin: { x: 0, y: 0.75 } }, opts)); }, 220);
    setTimeout(function () { c(Object.assign({ particleCount: 60, angle: 120, spread: 58, origin: { x: 1, y: 0.75 } }, opts)); }, 380);
  }

  // A new game starts counting afresh, so nothing ticks or flips on entry.
  function reset() { counts = {}; filled = null; }

  FY.FX = { counters: counters, travel: travel, segs: segs, celebrate: celebrate, reset: reset, reduced: function () { return reduceQ.matches; } };
})(window.FY = window.FY || {});
