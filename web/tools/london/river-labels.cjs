// Shared by the London and city renderers.
// Up to two spots on the river centreline, far from stations, with the text along the flow.
function pickRiverLabels(layout, stations) {
  const line = layout.river.line, out = [];
  for (let i = 2; i < line.length - 2; i++) {
    const [x, y] = line[i];
    if (x < 80 || y < 30 || x > layout.width - 80 || y > layout.height - 30) continue;
    const clearance = Math.min(...stations.map((p) => Math.hypot(p[0] - x, p[1] - y)));
    if (clearance < 62) continue;
    if (out.some((o) => Math.hypot(o.x - x, o.y - y) < 300)) continue;
    let a = Math.atan2(line[i + 2][1] - line[i - 2][1], line[i + 2][0] - line[i - 2][0]);
    if (a > Math.PI / 2) a -= Math.PI;
    if (a < -Math.PI / 2) a += Math.PI;
    out.push({ x, y, a, c: clearance });
  }
  return out.sort((p, q) => q.c - p.c).slice(0, 2);
}

module.exports = { pickRiverLabels };
