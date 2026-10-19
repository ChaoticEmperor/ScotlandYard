/* Fog Yard: board model built from window.FY_DATA (graph.json + layout.json). */
(function (FY) {
  "use strict";

  var TYPES = ["taxi", "bus", "underground", "ferry"];

  function build(data) {
    var g = data.graph, L = data.layout, N = g.stations;
    var adj = {}, edges = [], pos = [null], i;
    TYPES.forEach(function (t) {
      adj[t] = [];
      for (i = 0; i <= N; i++) adj[t].push([]);
    });
    TYPES.forEach(function (t) {
      (g.edges[t] || []).forEach(function (e) {
        adj[t][e[0]].push(e[1]);
        adj[t][e[1]].push(e[0]);
        edges.push({ a: e[0], b: e[1], t: t });
      });
    });
    for (i = 1; i <= N; i++) pos.push({ x: L.positions[i][0], y: L.positions[i][1] });

    var kind = [null];
    for (i = 1; i <= N; i++) kind.push(adj.underground[i].length ? "underground" : adj.bus[i].length ? "bus" : "taxi");

    // Hop distance over every transport (used by AI and hints).
    var all = [[]];
    for (i = 1; i <= N; i++) {
      var s = {};
      TYPES.forEach(function (t) { adj[t][i].forEach(function (n) { s[n] = 1; }); });
      all.push(Object.keys(s).map(Number));
    }
    var dist = [null];
    for (i = 1; i <= N; i++) {
      var d = new Int16Array(N + 1).fill(99), q = [i];
      d[i] = 0;
      for (var h = 0; h < q.length; h++) {
        var u = q[h];
        for (var k = 0; k < all[u].length; k++) if (d[all[u][k]] === 99) { d[all[u][k]] = d[u] + 1; q.push(all[u][k]); }
      }
      dist.push(d);
    }

    return {
      N: N, W: L.width, H: L.height, pos: pos, adj: adj, edges: edges, kind: kind,
      neighbours: all, dist: dist, starts: g.starts, types: TYPES
    };
  }

  FY.Board = { build: build, TYPES: TYPES };
})(window.FY = window.FY || {});
