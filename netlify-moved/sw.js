/* Find Mr. X moved to Cloudflare Pages. Phones that played on the old Netlify address have the
   old offline cache, which serves pages from the phone without asking the server. This script
   replaces it as an ordinary update: it deletes the old cache, removes itself, and sends any
   open page to the same path on the new address. */
var NEW_HOME = "https://scotlandyard-98u.pages.dev";

self.addEventListener("install", function () { self.skipWaiting(); });

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { return caches.delete(k); }));
  }).then(function () {
    return self.registration.unregister();
  }).then(function () {
    return self.clients.matchAll({ type: "window" });
  }).then(function (clients) {
    clients.forEach(function (c) {
      var u = new URL(c.url);
      c.navigate(NEW_HOME + u.pathname + u.search + u.hash);
    });
  }));
});
