/* Fog Yard: localStorage wrapper (every access guarded; private windows may block storage),
   settings, one-time tips and saved games. */
(function (FY) {
  "use strict";
  // ?profile=name keeps separate storage per tab, for the multi-player tests only: it is ignored
  // on real sites, so nobody can mint a second identity in the same browser.
  var local = location.protocol === "file:" || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var profile = local ? (location.search.match(/[?&]profile=([a-z0-9]+)/i) || [])[1] : null;
  var P = FY.CONFIG.storagePrefix + (profile ? profile + "." : "");

  function get(key, fallback) {
    try {
      var v = localStorage.getItem(P + key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  }
  function set(key, value) {
    try {
      if (value == null) localStorage.removeItem(P + key);
      else localStorage.setItem(P + key, JSON.stringify(value));
      return true;
    } catch (e) { return false; }
  }

  var DEFAULTS = {
    theme: "auto", // auto | light | dark
    tips: FY.CONFIG.hints.learningTips,
    tactical: FY.CONFIG.hints.tactical,
    level: "normal",
    detectives: FY.CONFIG.rules.detectivePawns,
    vibrate: true,
    awake: true, // keep the screen on during online games
    name: "",
    alias: ""
  };
  function settings() {
    var s = get("settings", {}), out = {};
    Object.keys(DEFAULTS).forEach(function (k) { out[k] = k in s ? s[k] : DEFAULTS[k]; });
    return out;
  }
  function saveSetting(k, v) {
    var s = settings();
    s[k] = v;
    set("settings", s);
    return s;
  }

  function tipSeen(id) { return !!get("tips", {})[id]; }
  function markTip(id) { var t = get("tips", {}); t[id] = 1; set("tips", t); }
  function resetTips() { set("tips", {}); }

  // A stable random id for this device (used to rejoin online games).
  function deviceId() {
    var id = get("device", null);
    if (!id) { id = "d" + Math.random().toString(36).slice(2, 12); set("device", id); }
    return id;
  }

  // Whether this browser actually keeps what we save (private windows may not).
  function works() {
    try { localStorage.setItem(P + "probe", "1"); var ok = localStorage.getItem(P + "probe") === "1"; localStorage.removeItem(P + "probe"); return ok; } catch (e) { return false; }
  }

  FY.Store = {
    get: get, set: set, works: works, prefix: P, settings: settings, saveSetting: saveSetting,
    tipSeen: tipSeen, markTip: markTip, resetTips: resetTips, deviceId: deviceId
  };
})(window.FY = window.FY || {});
