# Bengaluru Metro Station Viewer (version 4)

An interactive map of Namma Metro stations, built for the footpath assessment. It shows the 7 footpath survey stations, the 500 m walk area of every station, the main roads to be surveyed in each, and the extension roads beyond 500 m.

Prepared by Janaagraha, November 2026.

## Publish on GitHub Pages

1. Open the existing repository. To keep the current version live while you check this one, create a branch such as `v2`, or a new repository.
2. Upload everything in this folder, keeping the folder structure: `index.html`, `css/`, `js/`, `lib/`, `data/` and `tools/`.
3. In the repository, go to **Settings** → **Pages** → **Deploy from a branch** and pick the branch and `/ (root)`.
4. Open the site, click a few stations, and switch on each layer once.

`data/fallback-data.js` (about 10 MB) is needed only for opening the viewer by double-clicking `index.html`. On GitHub Pages it is never loaded, so you can leave it out of the upload.

## Layers

| Layer | File |
| --- | --- |
| Metro stations; survey stations ringed | `data/stations.csv` |
| Metro corridors | `data/metro_lines.geojson` |
| 500 m walk areas (ArcGIS Pro Service Area, split between neighbouring stations) | `data/walk_catchments_500m.geojson` |
| Main roads within 500 m, by type | `data/main_roads_500m.geojson` |
| Extension roads and the places they lead to | `data/extensions.geojson`, `data/extension_targets.geojson` |
| Station entrances | `data/entrances.geojson` |
| 5 km and 12 km from Majestic | `data/area_rings.geojson` |
| Completed Tender S.U.R.E. roads | `data/tender_sure_roads.geojson` |
| 800 m walk areas and circles, for comparison | `data/walk_catchments_800m.geojson`, `data/circles_800m.geojson` |
| Land use 2017 (KSRSAC), loaded only when switched on | `data/landuse_2017.geojson` |
| Corporation boundaries | `data/corporations.geojson` |
| Master plan 2015 or draft 2031 | links in `data/config.json` |

Clicking a station shows ridership, why it was picked (survey stations), footpath and road length within 500 m, extensions, and the 800 m figures for comparison.

## Updating the data

The 500 m files come from the ArcGIS Pro run (`C:\MetroWalk\outputs\web`). To update, replace the files in `data/` with the same names. `data/fallback-data.js` is only for opening the page by double-clicking; rebuild it with `python tools/make_fallback.py`.
