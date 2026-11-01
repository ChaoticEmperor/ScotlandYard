/* Find Mr. X sound effects and haptics. Sounds are synthesised with Web Audio, so there are no
   files to load and they work offline. Browsers only allow sound after the first tap, so the
   audio context is created (or resumed) on the first press. Settings: sound, vibrate. */
(function (FY) {
  "use strict";
  var AC = window.AudioContext || window.webkitAudioContext, ctx = null, out = null, hiss = null;

  function unlock() {
    if (!AC) return;
    try {
      if (!ctx) {
        ctx = new AC();
        out = ctx.createGain();
        out.gain.value = 0.5;
        out.connect(ctx.destination);
      }
      if (ctx.state === "suspended") ctx.resume();
    } catch (e) { ctx = null; }
  }
  ["pointerdown", "keydown"].forEach(function (t) { document.addEventListener(t, unlock, { capture: true, passive: true }); });

  // Repeats sound alive when the pitch moves a little each time (about ±4%).
  function vary(f) { return f * (1 + (Math.random() - 0.5) * 0.08); }

  // One note: an oscillator through a quick attack and an exponential fade, t0 seconds from now.
  function tone(freq, t0, dur, type, gain, glideTo) {
    var t = ctx.currentTime + t0, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  // A burst of filtered noise, for the thump under a capture.
  function noise(t0, dur, gain, freq) {
    if (!hiss) {
      hiss = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      var d = hiss.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    var t = ctx.currentTime + t0, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = hiss;
    f.type = "lowpass";
    f.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(out);
    src.start(t);
    src.stop(t + dur);
  }

  // Strongest events get the most layers: a move is a soft tick, a capture a full chord.
  var SOUNDS = {
    move: function () { tone(vary(520), 0, 0.09, "triangle", 0.16); tone(vary(780), 0.025, 0.07, "sine", 0.06); },
    turn: function () { tone(660, 0, 0.16, "sine", 0.22); tone(990, 0.11, 0.24, "sine", 0.2); },
    reveal: function () {
      tone(196, 0, 0.42, "sawtooth", 0.05, 784);
      tone(784, 0.34, 0.32, "triangle", 0.2);
      tone(1175, 0.42, 0.4, "sine", 0.14);
    },
    caught: function () {
      noise(0, 0.3, 0.5, 700);
      [392, 494, 587, 784].forEach(function (f, i) { tone(f, 0.06 + i * 0.08, 0.7, "triangle", 0.16); });
    },
    escape: function () {
      tone(392, 0, 0.22, "square", 0.05);
      tone(330, 0.2, 0.22, "square", 0.05);
      tone(262, 0.4, 0.8, "triangle", 0.18, 196);
    }
  };

  function play(name) {
    if (!FY.Store.settings().sound || !ctx || ctx.state !== "running" || !SOUNDS[name]) return;
    try { SOUNDS[name](); } catch (e) {}
  }
  // Browsers refuse to vibrate before the first tap, so check that first.
  function buzz(pattern) {
    if (!FY.Store.settings().vibrate || !navigator.vibrate) return;
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    try { navigator.vibrate(pattern); } catch (e) {}
  }

  FY.SFX = { play: play, buzz: buzz };
})(window.FY = window.FY || {});
