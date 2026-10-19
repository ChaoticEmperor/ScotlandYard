/* Shadow Line offline cache. After one visit with internet, the whole site (and the pinned PeerJS
   and font files from jsDelivr) loads without a connection: solo play works fully offline.
   Online games still need internet for the PeerJS server.
   VERSION and FILES are written by tools/package.py; a new deploy brings a new VERSION, which
   replaces the old cache. */
var VERSION = "fy-1385f1ba2da7";
var FILES = /*FILES*/["./", "assets/icon-192.png", "assets/icon-512.png", "assets/icon.svg", "assets/map.jpg", "css/app.css", "css/map.css", "data/board.js", "index.html", "js/ai.js", "js/board.js", "js/config.js", "js/game.js", "js/mapview.js", "js/net.js", "js/rules.js", "js/scene.js", "js/store.js", "js/terrain.js", "js/ui.js", "manifest.webmanifest"]/*END*/;
var CDN = [
  "https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js",
  "https://cdn.jsdelivr.net/npm/@fontsource/oswald@5.2.5/500.css",
  "https://cdn.jsdelivr.net/npm/@fontsource/oswald@5.2.5/700.css"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(VERSION).then(function (cache) {
    return cache.addAll(FILES).then(function () {
      // CDN files are cached best-effort (opaque responses are fine for scripts and styles).
      return Promise.all(CDN.map(function (u) {
        return fetch(u, { mode: "no-cors" }).then(function (r) { return cache.put(u, r); }).catch(function () {});
      }));
    });
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Cache first, refreshed in the background (so a new deploy is picked up on the next visit).
// Pages are matched without their query string (?transport=…), and anything not cached
// falls back to the network. The PeerJS signalling server is never intercepted.
self.addEventListener("fetch", function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  var same = url.origin === self.location.origin, cdn = url.hostname === "cdn.jsdelivr.net";
  if (!same && !cdn) return;
  var key = req.mode === "navigate" ? "index.html" : req;
  e.respondWith(caches.open(VERSION).then(function (cache) {
    return cache.match(key, { ignoreSearch: same }).then(function (hit) {
      var fresh = fetch(req).then(function (r) {
        if (r && (r.ok || r.type === "opaque")) cache.put(key, r.clone());
        return r;
      }).catch(function () { return hit; });
      return hit || fresh;
    });
  }));
});
