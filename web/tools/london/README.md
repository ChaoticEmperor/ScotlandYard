# London map pipeline

This folder builds `web/assets/map.jpg`, a stylized central-London map, and fits the station layout onto it so the ferry stations sit on the River Thames.

**Map data © OpenStreetMap contributors**, available under the [Open Database License (ODbL)](https://www.openstreetmap.org/copyright).
- The rendered `map.jpg` is a *Produced Work* and must keep the attribution. The attribution is baked into the image corner and repeated in the site's About dialog and README.
- The intermediate extracts (`central.json`, `thames.json`, `projected.json`) are derived databases. They are **not committed or shipped**; regenerate them with the steps below.
- Only the simplified Thames centreline (in board pixels) is stored, in `data/layout.json`.

## Steps

```sh
# 0. Get a London extract (~200 MB) and the reader
curl -LO https://download.bbbike.org/osm/bbbike/London/London.osm.pbf
python3 -m venv .venv && .venv/bin/pip install osmium

# 1. Central-London features (roads, rail, water, parks, buildings, place names)
.venv/bin/python web/tools/london/extract_osm.py London.osm.pbf central.json
python3 web/tools/london/thames.py central.json thames.json

# 2. Original layout, then fit it onto the Thames (north stays up; the layout rotates instead)
node web/tools/build-layout.mjs
node web/tools/london/fit-layout.mjs thames.json
node web/tools/validate-layout.mjs && node web/tools/bundle-data.mjs

# 3. Render the map image (needs Playwright with Chromium)
python3 web/tools/london/project_osm.py central.json web/data/layout.json projected.json 2
node web/tools/london/rasterize.cjs projected.json      # writes web/assets/map.jpg
```

## How the fit works

`fit-layout.mjs`:
1. **Search.** Over scale, rotation, mirroring and offset, it finds where ferry stations 194, 157, 115 and 108 land on the Thames centreline, in order along the river.
2. **Re-express.** It writes the layout in a north-up frame. The station layout is rotated or mirrored, never the map.
3. **Warp locally.** It nudges stations so:
   - no station except a ferry stop is within 20 px of the water;
   - ferry stops sit on the bank;
   - roads cross the river as rarely as possible.

   It keeps 44 px spacing, no taxi crossings and no routes grazing stations.
