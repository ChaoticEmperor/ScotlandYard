#!/usr/bin/env python3
"""Find well-known central-London landmarks in an OpenStreetMap .pbf (positions only).

Map data (c) OpenStreetMap contributors, ODbL. The icons drawn for these places are
generic shapes from render-city.html, not copies of any board artwork.
Usage: python3 landmarks.py London.osm.pbf landmarks.json
"""
import json
import sys

import osmium

# Display name -> (accepted OSM names, generic icon)
WANTED = {
    "British Museum": (["British Museum"], "museum"),
    "St Paul's Cathedral": (["St Paul's Cathedral"], "dome"),
    "Tower of London": (["Tower of London"], "castle"),
    "Tower Bridge": (["Tower Bridge"], "bridge"),
    "Big Ben": (["Elizabeth Tower", "Big Ben"], "clock"),
    "Westminster Abbey": (["Westminster Abbey"], "church"),
    "Buckingham Palace": (["Buckingham Palace"], "palace"),
    "London Eye": (["London Eye", "The London Eye", "lastminute.com London Eye"], "wheel"),
    "Nelson's Column": (["Nelson's Column"], "column"),
    "Tate Modern": (["Tate Modern"], "chimney"),
    "The Shard": (["The Shard", "Shard London Bridge"], "shard"),
    "Piccadilly Circus": (["Piccadilly Circus"], "fountain"),
    "Covent Garden": (["Covent Garden Market", "Covent Garden Piazza", "The Market Building"], "market"),
    "Royal Albert Hall": (["Royal Albert Hall"], "hall"),
    "Natural History Museum": (["Natural History Museum"], "museum"),
    "BT Tower": (["BT Tower"], "mast"),
    "Madame Tussauds": (["Madame Tussauds", "Madame Tussauds London"], "hall"),
    "King's Cross": (["London King's Cross", "King's Cross"], "station"),
    "St Pancras": (["London St Pancras International", "St Pancras International"], "station"),
    "Smithfield Market": (["Smithfield Market", "Central Markets", "London Central Markets"], "market"),
    "Bank of England": (["Bank of England"], "museum"),
    "Southwark Cathedral": (["Southwark Cathedral"], "church"),
    "Shakespeare's Globe": (["Shakespeare's Globe", "Shakespeare's Globe Theatre"], "globe"),
    "Somerset House": (["Somerset House"], "palace"),
    "National Gallery": (["National Gallery", "The National Gallery"], "museum"),
    "Marble Arch": (["Marble Arch"], "arch"),
    "Wellington Arch": (["Wellington Arch"], "arch"),
    "Battersea Power Station": (["Battersea Power Station"], "chimney"),
    "Royal Festival Hall": (["Royal Festival Hall"], "hall"),
    "Lord's": (["Lord's Cricket Ground", "Lord's"], "stadium"),
    "Emirates Stadium": (["Emirates Stadium"], "stadium"),
    "The Gherkin": (["30 St Mary Axe", "The Gherkin"], "gherkin"),
    "Liverpool Street": (["London Liverpool Street", "Liverpool Street"], "station"),
    "Waterloo": (["London Waterloo"], "station"),
    "Paddington": (["London Paddington"], "station"),
    "Victoria": (["London Victoria"], "station"),
    "Euston": (["London Euston"], "station"),
    "Monument": (["Monument to the Great Fire of London", "The Monument"], "column"),
    "Royal Courts of Justice": (["Royal Courts of Justice"], "church"),
    "Kensington Palace": (["Kensington Palace"], "palace"),
}
LOOKUP = {}
for disp, (names, icon) in WANTED.items():
    for n in names:
        LOOKUP[n] = (disp, icon)


class H(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.found = {}

    def take(self, name, lon, lat, size, tags):
        disp, icon = LOOKUP[name]
        if icon == "station" and tags.get("railway") not in ("station",) and tags.get("public_transport") != "station":
            return
        best = self.found.get(disp)
        if best is None or size > best["size"]:
            self.found[disp] = {"name": disp, "icon": icon, "at": [round(lon, 6), round(lat, 6)], "size": size}

    def node(self, n):
        name = n.tags.get("name")
        if name in LOOKUP:
            self.take(name, n.location.lon, n.location.lat, 0, n.tags)

    def area(self, a):
        name = a.tags.get("name")
        if name not in LOOKUP:
            return
        try:
            pts = [(nd.lon, nd.lat) for ring in a.outer_rings() for nd in ring]
        except osmium.InvalidLocationError:
            return
        if not pts:
            return
        lon = sum(p[0] for p in pts) / len(pts)
        lat = sum(p[1] for p in pts) / len(pts)
        size = (max(p[0] for p in pts) - min(p[0] for p in pts)) * (max(p[1] for p in pts) - min(p[1] for p in pts))
        self.take(name, lon, lat, size + 1e-9, a.tags)


def main():
    h = H()
    h.apply_file(sys.argv[1], locations=True)
    out = sorted(h.found.values(), key=lambda f: f["name"])
    for f in out:
        f.pop("size")
    json.dump(out, open(sys.argv[2], "w"), indent=1)
    missing = sorted(set(WANTED) - {f["name"] for f in out})
    print(f"found {len(out)} landmarks; missing: {missing}")


if __name__ == "__main__":
    main()
