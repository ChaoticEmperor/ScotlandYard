#!/usr/bin/env python3
"""Project the central-London extract into Shadow Line board pixels for render.html.

Map data (c) OpenStreetMap contributors, ODbL. The output is a working file, not shipped.
Usage: python3 project_osm.py central.json ../../data/layout.json projected.json [scale]
Coordinates are written as integers in raster pixels (board px * scale).
"""
import json
import sys


def main():
    src = json.load(open(sys.argv[1]))
    lay = json.load(open(sys.argv[2]))
    out_path = sys.argv[3]
    sc = float(sys.argv[4]) if len(sys.argv) > 4 else 2.0
    g = lay["geo"]
    W, H = lay["width"], lay["height"]
    M = 24  # margin in board px

    def px(p):
        x = ((p[0] - g["lon0"]) * g["kx"] - g["mx0"]) / g["metresPerPx"]
        y = (-(p[1] - g["lat0"]) * g["ky"] - g["my0"]) / g["metresPerPx"]
        return x, y

    def proj(pts, min_extent=0.0):
        q, last = [], None
        xs, ys = [], []
        for p in pts:
            x, y = px(p)
            xs.append(x)
            ys.append(y)
            r = (round(x * sc), round(y * sc))
            if r != last:
                q.append(r)
                last = r
        if max(xs) < -M or min(xs) > W + M or max(ys) < -M or min(ys) > H + M:
            return None
        if max(xs) - min(xs) < min_extent and max(ys) - min(ys) < min_extent:
            return None
        return [c for xy in q for c in xy]

    def area_px(flat):
        a = 0.0
        for i in range(0, len(flat) - 2, 2):
            a += flat[i] * flat[i + 3] - flat[i + 2] * flat[i + 1]
        return abs(a) / 2 / (sc * sc)

    out = {"W": W, "H": H, "scale": sc, "water": [], "green": [], "buildings": [], "roads": [], "rail": [], "labels": []}
    for kind in ("water", "green"):
        for f in src[kind]:
            ring = proj(f["p"])
            if not ring:
                continue
            item = {"p": ring, "h": [r for r in (proj(h) for h in f.get("h", [])) if r]}
            out[kind].append(item)
            if kind == "green" and f.get("n") and area_px(ring) > 1600:
                xs, ys = ring[0::2], ring[1::2]
                out["labels"].append({"t": f["n"], "k": "park", "x": sum(xs) / len(xs) / sc, "y": sum(ys) / len(ys) / sc, "a": area_px(ring)})
    for f in src["buildings"]:
        ring = proj(f["p"], 0.6)
        if ring and len(ring) >= 6:
            out["buildings"].append(ring)
    for f in src["roads"]:
        line = proj(f["p"])
        if line and len(line) >= 4:
            out["roads"].append([f["c"]] + line)
    for f in src["rail"]:
        line = proj(f)
        if line and len(line) >= 4:
            out["rail"].append(line)
    for p in src["places"]:
        x, y = px(p["at"])
        if 0 <= x <= W and 0 <= y <= H:
            out["labels"].append({"t": p["name"], "k": p["kind"], "x": x, "y": y})
    json.dump(out, open(out_path, "w"), separators=(",", ":"))
    print({k: len(v) for k, v in out.items() if isinstance(v, list)})


if __name__ == "__main__":
    main()
