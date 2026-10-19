#!/usr/bin/env python3
"""Extract a central-London feature set from an OpenStreetMap .pbf for the Find Mr. X map.

Map data (c) OpenStreetMap contributors, ODbL. The output is a working file for
render_map.py and build-layout.mjs; it is not shipped with the site.

Usage: python3 extract_osm.py London.osm.pbf out.json
Needs: pip install osmium   (the BBBike "London" extract works well)
"""
import json
import sys

import osmium

BBOX = (-0.245, 51.455, 0.005, 51.565)  # lon/lat: Shepherd's Bush to Canary Wharf, Brixton to Highbury
ROADS = {
    "motorway": 5, "trunk": 5, "primary": 4, "secondary": 3, "tertiary": 2,
    "motorway_link": 3, "trunk_link": 3, "primary_link": 3, "secondary_link": 2, "tertiary_link": 2,
    "residential": 1, "unclassified": 1, "living_street": 1, "pedestrian": 1,
}
GREEN_LEISURE = {"park", "garden", "common", "nature_reserve", "golf_course", "recreation_ground"}
GREEN_LANDUSE = {"grass", "recreation_ground", "cemetery", "forest", "meadow", "village_green", "allotments"}
PLACES = {"suburb", "quarter", "neighbourhood"}


def inside(lon, lat, pad=0.0):
    return BBOX[0] - pad <= lon <= BBOX[2] + pad and BBOX[1] - pad <= lat <= BBOX[3] + pad


def ring(nodes):
    return [[round(n.lon, 6), round(n.lat, 6)] for n in nodes]


class H(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.out = {"bbox": BBOX, "water": [], "thames": [], "green": [], "buildings": [], "roads": [], "rail": [], "places": []}

    def node(self, n):
        t = n.tags
        if t.get("place") in PLACES and "name" in t and inside(n.location.lon, n.location.lat):
            self.out["places"].append({"name": t["name"], "kind": t["place"], "at": [round(n.location.lon, 6), round(n.location.lat, 6)]})

    def way(self, w):
        t = w.tags
        try:
            pts = ring(w.nodes)
        except osmium.InvalidLocationError:
            return
        if not pts or not any(inside(p[0], p[1], 0.01) for p in pts):
            return
        hw = t.get("highway")
        if hw in ROADS and t.get("tunnel") not in ("yes", "building_passage") and t.get("area") != "yes":
            self.out["roads"].append({"c": ROADS[hw], "p": pts, "n": t.get("name", "")})
        elif t.get("railway") == "rail" and t.get("tunnel") != "yes" and t.get("service") is None:
            self.out["rail"].append(pts)
        if t.get("waterway") == "river" and t.get("name") == "River Thames":
            self.out["thames"].append(pts)

    def area(self, a):
        t = a.tags
        kind = None
        if t.get("natural") == "water" or t.get("waterway") in ("riverbank", "dock") or t.get("landuse") == "basin":
            kind = "water"
        elif t.get("leisure") in GREEN_LEISURE or t.get("landuse") in GREEN_LANDUSE or t.get("natural") in ("wood", "grassland", "scrub"):
            kind = "green"
        elif "building" in t:
            kind = "buildings"
        if not kind:
            return
        try:
            for outer in a.outer_rings():
                pts = ring(outer)
                if len(pts) < 4 or not any(inside(p[0], p[1], 0.005) for p in pts):
                    continue
                holes = [ring(r) for r in a.inner_rings(outer)] if kind != "buildings" else []
                item = {"p": pts}
                if holes:
                    item["h"] = holes
                if kind != "buildings" and t.get("name"):
                    item["n"] = t["name"]
                if kind == "water" and t.get("name") == "River Thames" or t.get("water") == "river":
                    item["river"] = 1
                self.out[kind].append(item)
        except osmium.InvalidLocationError:
            pass


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    h = H()
    h.apply_file(sys.argv[1], locations=True)
    with open(sys.argv[2], "w") as f:
        json.dump(h.out, f, separators=(",", ":"))
    print({k: len(v) for k, v in h.out.items() if isinstance(v, list)})


if __name__ == "__main__":
    main()
