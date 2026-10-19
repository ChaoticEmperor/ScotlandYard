# Illustrated city board

`render-city.html` paints the default board image, `web/assets/map.jpg`, in an illustrated bird's-eye style. The game's routes *are* the streets:
- **Taxi links** are the streets: cream roads with yellow kerbs, drawn as vector SVG by `js/mapview.js` so they stay crisp at any zoom.
- **Bus links** run as teal lanes along those streets, following the taxi path between their stops (`busAlongRoads` in `js/scene.js`). 91 of the 99 do this; the other 8 are curves where the road path would be a long detour or both sides of the road are already used.
- **Houses line every street.** They are small oblique-view buildings with hip, flat or slate roofs, lit walls, windows and shadows. Block interiors are filled with more houses, gardens and trees.
- **Real geography** comes from OpenStreetMap: the River Thames (with stone embankments), parks, thin unmarked side streets that continue the city to the frame, and **landmark positions**. Landmarks are drawn as *generic, original icons*: dome, columned museum, keep, clock tower, wheel, train shed and so on. Nothing is traced or copied from any game board.

Map data © OpenStreetMap contributors (ODbL). The attribution is baked into the image corner and is also shown in the About dialog and README.

## Build

The inputs come from the London pipeline (`../london/README.md`, steps 0-2):

```sh
python3 web/tools/london/project_osm.py central.json web/data/layout.json projected.json 2
.venv/bin/python web/tools/london/landmarks.py London.osm.pbf landmarks.json
node web/tools/city/rasterize-city.cjs projected.json landmarks.json   # writes web/assets/map.jpg
```

Rendering takes a few seconds and is deterministic: it uses a fixed seed, and the scene geometry comes from the same `js/scene.js` the game uses, so the roads in the image line up exactly with the SVG routes.
