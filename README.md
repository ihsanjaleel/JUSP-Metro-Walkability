# Bengaluru Metro Station Viewer (version 2)

An interactive map of Namma Metro stations, built for the footpath assessment. It shows:

- what kind of place each station serves (its primary type, from ridership and land use);
- how much of the area around each station people can actually reach within an 800 m walk;
- the land use, footfall and street length behind each station.

Prepared by Janaagraha, November 2026.

## Publish on GitHub Pages

1. Open the existing repository. To keep the current version live while you check this one, create a branch such as `v2`, or a new repository.
2. Upload everything in this folder, keeping the folder structure: `index.html`, `css/`, `js/`, `lib/`, `data/` and `tools/`.
3. In the repository, go to **Settings** → **Pages** → **Deploy from a branch** and pick the branch and `/ (root)`.
4. Open the site, click a few stations, and switch on each layer once.

`data/fallback-data.js` (about 10 MB) is needed only for opening the viewer by double-clicking `index.html`. On GitHub Pages it is never loaded, so you can leave it out of the upload.

## Layers

All layers are in one panel:

| Layer | Source |
| --- | --- |
| Metro stations, coloured by primary type; legend entries switch types on and off | `data/stations.csv` |
| Metro corridors; legend entries switch lines on and off | `data/metro_lines.geojson` |
| 800 m walking catchments | `data/walk_catchments_800m.geojson` (ArcGIS Pro Service Area, unchanged) |
| 800 m circles, for comparison | `data/circles_800m.geojson` (ArcGIS Pro, unchanged) |
| Land use 2017 (KSRSAC), loaded only when switched on | `data/landuse_2017.geojson` |
| GBA corporation boundaries | `data/corporations.geojson` |
| Master plan 2015 or draft 2031, with one opacity slider | links in `data/config.json` |

Clicking a station shows:

- its type and tags;
- weekday and weekend-day ridership;
- walking area and street length within 800 m;
- its top three land uses;
- any data flag.

## Updating the data (no code changes)

Every file in `data/` can be replaced on its own. Keep the column and field names.

- **`stations.csv`:** one row per station.
  - `primary_category` must be one of: `residential`, `mixed`, `office`, `commercial`, `institutional`, `industrial`, `leisure`, `unclassified`. Labels and colours are set in `config.json`.
  - `provisional` = `yes` draws a hollow marker.
  - Ridership columns are daily averages of entries plus exits.
  - `walk_area_km2`, `street_km_walkable_800m` and `street_km_in_circle` come from the ArcGIS `catchment_summary.csv`.
- **Catchments and circles:** export new GeoJSON from ArcGIS in WGS84, with a `station_id` field matching `stations.csv`.
- **`landuse_2017.geojson`:** polygons with a `group` field; colours are set in `config.json` under `landuse`.
- **New ridership month:** update the ridership columns in `stations.csv`. Recheck the types of stations near the cut-off values.
- **Opening from a folder after changing data:** run `python tools/make_fallback.py`.

## What changed from version 1

- The panel has only Layers. The Filters and Data tabs and the extra opacity sliders are gone.
- Station types are reworked from ridership plus land use. Interchange is now a tag, and distance from the centre is no longer used.
- The 800 m walking catchments from ArcGIS are added. The circles are kept for comparison, and the 400 m ring is gone.
- The KSRSAC 2017 land-use layer is added.
- The draft 2031 master plan now displays: `lib/geotiff.js` is now version 3.1.0-beta.0, which the bundled OpenLayers 10.11 needs.
- The station panel is simpler, with ridership, walking area, street length and land use.

## Cautions

- **Land use:** KSRSAC 2017 covers only the former BBMP area. Eight stations outside it have provisional types based on OpenStreetMap sites, and two more (Manjunathanagara, Beratena Agrahara) are only partly covered.
- **Ridership:** the Yellow Line figures come from its first weeks of service, and the Pink Line has no data yet.
- **Street length:** this is the walkable road and path network in OpenStreetMap, not surveyed footpaths.
- **2031 plan:** the image is hosted by the Master Plan Viewer project. Host our own copy or get their permission, then change its link in `data/config.json`.
