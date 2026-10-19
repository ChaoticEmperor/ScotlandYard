#!/usr/bin/env python3
"""Reduce the extract from extract_osm.py to the River Thames: one ordered centerline and its water polygons.

Map data (c) OpenStreetMap contributors, ODbL.
Usage: python3 thames.py central.json thames.json
"""
import json
import math
import sys


def key(p):
    return (round(p[0], 6), round(p[1], 6))


def chain(ways):
    """Join way pieces end to end into the longest ordered polyline."""
    ways = [list(w) for w in ways if len(w) > 1]
    best = []
    while ways:
        line = ways.pop(0)
        grown = True
        while grown:
            grown = False
            for i, w in enumerate(ways):
                if key(w[0]) == key(line[-1]):
                    line += w[1:]
                elif key(w[-1]) == key(line[-1]):
                    line += w[::-1][1:]
                elif key(w[-1]) == key(line[0]):
                    line = w[:-1] + line
                elif key(w[0]) == key(line[0]):
                    line = w[::-1][:-1] + line
                else:
                    continue
                ways.pop(i)
                grown = True
                break
        if len(line) > len(best):
            best = line
    return best


def simplify(pts, tol):
    """Douglas-Peucker in degrees scaled to metres."""
    if len(pts) < 3:
        return pts
    k = math.cos(math.radians(51.5))

    def d(p, a, b):
        ax, ay, bx, by, px, py = a[0] * k, a[1], b[0] * k, b[1], p[0] * k, p[1]
        dx, dy = bx - ax, by - ay
        l2 = dx * dx + dy * dy or 1e-18
        t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
        return math.hypot(px - ax - t * dx, py - ay - t * dy) * 111320

    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        far, at = 0, -1
        for m in range(i + 1, j):
            dd = d(pts[m], pts[i], pts[j])
            if dd > far:
                far, at = dd, m
        if far > tol:
            keep[at] = True
            stack += [(i, at), (at, j)]
    return [p for p, k2 in zip(pts, keep) if k2]


def main():
    src = json.load(open(sys.argv[1]))
    line = simplify(chain(src["thames"]), 8)
    water = [{"p": simplify(w["p"], 4), "h": [simplify(h, 4) for h in w.get("h", [])]} for w in src["water"] if w.get("river")]
    json.dump({"centerline": line, "water": water}, open(sys.argv[2], "w"), separators=(",", ":"))
    print(f"centerline {len(line)} pts, water polygons {len(water)} ({sum(len(w['p']) for w in water)} pts)")


if __name__ == "__main__":
    main()
