/* Fog Yard: localStorage wrapper (every access guarded; private windows may block storage),
   settings, one-time tips and saved games. */
(function (FY) {
  "use strict";
  var P = FY.CONFIG.storagePrefix;

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
    name: ""
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

  FY.Store = {
    get: get, set: set, settings: settings, saveSetting: saveSetting,
    tipSeen: tipSeen, markTip: markTip, resetTips: resetTips, deviceId: deviceId
  };
})(window.FY = window.FY || {});
