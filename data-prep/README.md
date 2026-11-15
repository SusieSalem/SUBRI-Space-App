# Mission Architect — NASA Data Preparation (`data-prep/`)

Python 3 standard-library scripts (zero external dependencies) that generate, archive, and validate all NASA scientific datasets in [`public/data/`](../public/data/).

> **Archived Data Notice:** The JSON files generated into `public/data/` contain **archived real NASA datasets** (FIRMS wildfire detections, DONKI solar storms, SmallSat SOA specs, SCaN ground stations, and Orion/ESM reference values) so the game runs deterministically and offline in any browser without requiring API keys at runtime.

## Scripts

- [`fetch_firms.py`](fetch_firms.py): Builds `public/data/fires.json` from real archived NASA FIRMS (VIIRS/MODIS) active fire hotspot clusters. Supports optional live refresh via `FIRMS_MAP_KEY`:
  ```bash
  FIRMS_MAP_KEY=your_key uv run data-prep/fetch_firms.py --live
  ```
- [`fetch_donki.py`](fetch_donki.py): Builds `public/data/storms.json` from real historical NASA CCMC DONKI geomagnetic storms and solar energetic particle (SEP) events. Supports optional live refresh via `NASA_API_KEY`:
  ```bash
  NASA_API_KEY=your_key uv run data-prep/fetch_donki.py --live
  ```
- [`build_all_data.py`](build_all_data.py): Regenerates all JSON datasets in `public/data/` (`fires.json`, `storms.json`, `parts.json`, `rockets.json`, `stations.json`, `earth_body.json`, `earth_orbits.json`, `scenarios.json`, `crewed_lunar.json`, `explanations.json`), computes orbital periods via Kepler's Third Law and cylindrical Earth shadow durations, and validates all reference passing spacecraft designs.

## Running Locally

```bash
uv run data-prep/build_all_data.py
```
