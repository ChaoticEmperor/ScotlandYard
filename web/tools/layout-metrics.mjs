// Geometry helpers and quality metrics for station layouts (shared by build and validate).

export function segCross(p1, p2, p3, p4) {
  const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export function segPointDist(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const l2 = vx * vx + vy * vy || 1e-9;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l2));
  return Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy);
}

// P: array of [x, y] indexed by station-1; E: [a, b, type] with 0-based indices.
export function metrics(P, E) {
  let minSep = Infinity;
  for (let i = 0; i < P.length; i++)
    for (let j = i + 1; j < P.length; j++) minSep = Math.min(minSep, Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1]));
  let taxiCrossings = 0, bridges = 0, allCrossings = 0, grazes = 0;
  for (let k = 0; k < E.length; k++)
    for (let m = k + 1; m < E.length; m++) {
      const [a, b, t] = E[k], [c, d, u] = E[m];
      if (a === c || a === d || b === c || b === d) continue;
      if (segCross(P[a], P[b], P[c], P[d])) {
        allCrossings++;
        if (t === "taxi" && u === "taxi") taxiCrossings++;
        else if ((t === "ferry" && u === "taxi") || (t === "taxi" && u === "ferry")) bridges++;
      }
    }
  // Ferries are drawn along the river, never as straight lines, so only taxi roads can graze stations.
  for (const [a, b, t] of E) {
    if (t !== "taxi") continue;
    for (let j = 0; j < P.length; j++) if (j !== a && j !== b && segPointDist(P[j], P[a], P[b]) < 14) grazes++;
  }
  return { minSep: Math.round(minSep * 10) / 10, taxiCrossings, bridges, allCrossings, grazes };
}
