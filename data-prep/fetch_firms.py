#!/usr/bin/env python3
"""Fetch or build archived NASA FIRMS active fire targets for Mission Architect.

Usage:
  uv run data-prep/fetch_firms.py           # Uses FIRMS_MAP_KEY if set, else curated archive
  uv run data-prep/fetch_firms.py --live    # Force query to NASA FIRMS API (requires FIRMS_MAP_KEY)
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ARCHIVED_NOTICE = (
    "Archived real NASA FIRMS (Fire Information for Resource Management System / LANCE) "
    "VIIRS & MODIS active fire detections — bundled offline for reliable "
    "gameplay, not a live streaming feed."
)

# Curated archive: 24 real fire events. Which events to show is our choice; every number
# (lat, lon, brightnessK, frpMW, acquiredDate, satellite, confidence) is copied from one
# real FIRMS detection: the strongest (max FRP) nominal/high-confidence row for that fire
# in the public FIRMS country-year archive named in its sourceUrl (no key needed).
# brightnessK is bright_ti4 for VIIRS (saturates at 367 K) and band 21/22 for MODIS
# (saturates at 500 K). scienceValue is a game-balance parameter, NOT NASA data.
# Verified 2026-11-14: each row exists in its sourceUrl file.
ARCHIVED_FIRES: list[dict[str, Any]] = [
    {
        "id": "firms_us_ca_park",
        "name": "Northern California Ridge Cluster",
        "region": "North America",
        "lat": 40.0197,
        "lon": -121.67478,
        "brightnessK": 367.0,
        "frpMW": 1465.62,
        "acquiredDate": "2024-07-26",
        "satellite": "NOAA-20",
        "instrument": "VIIRS",
        "confidence": "high",
        "scienceValue": 100,
        "sourceUrl": "https://firms.modaps.eosdis.nasa.gov/data/country/viirs-jpss1/2024/viirs-jpss1_2024_United_States.csv",
    },
    {
        "id": "firms_us_or_durkee",
        "name": "Eastern Oregon Rangeland Fire",
        "region": "North America",
        "lat": 44.59916,
        "lon": -117.30244,
        "brightnessK": 367.0,
        "frpMW": 520.89,
        "acquiredDate": "2024-07-23",
        "satellite": "Suomi NPP",
        "instrument": "VIIRS",
        "confidence": "high",
        "scienceValue": 95,
        "sourceUrl": "https://firms.modaps.eosdis.nasa.gov/data/country/viirs-snpp/2024/viirs-snpp_2024_United_States.csv",
    },
    {
        "id": "firms_ca_ab_jasper",
        "name": "Canadian Rockies Boreal Complex",
        "region": "North America",
        "lat": 52.73194,
        "lon": -117.99847,
        "brightnessK": 321.55,
        "frpMW": 1339.22,
        "acquiredDate": "2024-07-24",
        "satellite": "NOAA-20",
        "instrument": "VIIRS",
        "confidence": "nominal",
        "scienceValue": 100,
        "sourceUrl": "https://firms.modaps.eosdis.nasa.gov/data/country/viirs-jpss1/2024/viirs-jpss1_2024_Canada.csv",
    },
    {
        "id": "firms_mx_bc_mexicali",
        "name": "Baja California Mexicali Valley Thermal Anomaly",
        "region": "North America",
        "lat": 32.1439,
        "lon": -115.146,
        "brightnessK": 351.7,
        "frpMW": 55.0,
        "acquiredDate": "2024-08-13",
        "satellite": "Aqua",
        "instrument": "MODIS",
        "confidence": "high",
        "scienceValue": 90,
        "sourceUrl": "https://firms.modaps.eosdis.nasa.gov/data/country/modis/2024/modis_2024_Mexico.csv",
    },
    {
        "id": "firms_mx_oax_chimalapas",
        "name": "Oaxaca Cloud Forest Fire Front",
        "region": "North America",
        "lat": 16.5835,
        "lon": -94.5215,
        "brightnessK": 354.9,
        "frpMW": 57.7,
        "acquiredDate": "2024-05-12",
        "satellite": "Aqua",
        "instrument": "MODIS",
        "confidence": "high",
        "scienceValue": 85,
        "sourceUrl": "https://firms.modaps.eosdis.nasa.gov/data/country/modis/2024/modis_2024_Mexico.csv",
    },
    {
        "id": "firms_br_amazon_para",
        "name": "Pará Southern Amazon Basin Cluster",
        "region": "South America",
        "lat": -8.8635,
        "lon": -55.03627,
        "brightnessK": 367.0,
        "frpMW": 313.78,
        "acquiredDate": "2024-09-08",
        "satellite": "Suomi NPP",
        "instrument": "VIIRS",
        "confidence": "high",
        "scienceValue": 95,
        "sourceUrl": "https://firms.modaps.eosdis.nasa.gov/data/country/viirs-snpp/2024/viirs-snpp_2024_Brazil.csv",
    },
    {
        "id": "firms_br_pantanal",
        "name": "Pantanal Wetland Front (Mato Grosso do Sul)",
        "region": "South America",
        "lat": -19.71235,
        "lon": -57.57915,
        "brightnessK": 367.0,
        "frpMW": 254.8,
        "acquiredDate": "2024-09-10",
        "satellite": "NOAA-20",
        "instrument": "VIIRS",
        "confidence": "high",
        "scienceValue": 100,
        "sourceUrl": "https://firms.modaps.eosdis.nasa.gov/data/country/viirs-jpss1/2024/viirs-jpss1_2024_Brazil.csv",
    },
    {
        "id": "firms_bo_chiquitania",
        "name": "Chiquitania Dry Forest Megafire",
        "region": "South America",
        "lat": -16.47187,
        "lon": -61.28902,
        "brightnessK": 353.55,
        "frpMW": 136.7,
        "acquiredDate": "2024-09-11",
        "satellite": "NOAA-20",
        "instrument": "VIIRS",
        "confidence": "nominal",
        "scienceValue": 95,
        "sourceUrl": "https://firms.modaps.eosdis.nasa.gov/data/country/viirs-jpss1/2024/viirs-jpss1_2024_Bolivia.csv",
    },
    {
        "id": "firms_cl_valparaiso",
        "name": "Central Chile Coastal Ridge Hotspot",
        "region": "South America",
        "lat": -33.05191,
        "lon": -71.52919,
        "brightnessK": 367.0,
        "frpMW": 323.6,
        "acquiredDate": "2024-02-03",
        "satellite": "Suomi NPP",
        "instrument": "VIIRS",
        "confidence": "high",
        "scienceValue": 95,
        "sourceUrl": "https://firms.modaps.eosdis.nasa.gov/data/country/viirs-snpp/2024/viirs-snpp_2024_Chile.csv",
    },
    {
        "id": "firms_pt_aveiro",
        "name": "Northern Portugal Pine Belt Cluster",
        "region": "Europe / Mediterranean",
        "lat": 40.6602,
        "lon": -8.33947,
        "brightnessK": 350.53,
        "frpMW": 799.65,
        "acquiredDate": "2024-09-17",
        "satellite": "NOAA-20",
        "instrument": "VIIRS",
        "confidence": "nominal",
        "scienceValue": 90,
        "sourceUrl": "https://firms.modaps.eosdis.nasa.gov/data/country/viirs-jpss1/2024/viirs-jpss1_2024_Portugal.csv",
    },
    {
        "id": "firms_gr_attica",
        "name": "Attica Scrubland Fire Front",
        "region": "Europe / Mediterranean",
        "lat": 38.1739,
        "lon": 23.9297,
        "brightnessK": 500.0,
        "frpMW": 2768.0,
        "acquiredDate": "2024-08-11",
        "satellite": "Terra",
        "instrument": "MODIS",
        "confidence": "high",
        "scienceValue": 90,
        "sourceUrl": "https://firms.modaps.eosdis.nasa.gov/data/country/modis/2024/modis_2024_Greece.csv",
    },
    {
        "id": "firms_es_tenerife",
        "name": "Canary Islands Montane Forest Spot",
        "region": "Europe / Mediterranean",
        "lat": 28.36577,
        "lon": -16.47287,
        "brightnessK": 339.27,
        "frpMW": 318.65,
        "acquiredDate": "2023-08-17",
        "satellite": "Suomi NPP",
        "instrument": "VIIRS",
        "confidence": "nominal",
        "scienceValue": 85,
        "sourceUrl": "https://firms.modaps.eosdis.nasa.gov/data/country/viirs-snpp/2023/viirs-snpp_2023_Spain.csv",
    },
    {
        "id": "firms_cd_savanna",
        "name": "Congo Basin Southern Savanna Burn",
        "region": "Africa",
        "lat": -8.5735,
        "lon": 22.7049,
        "brightnessK": 487.7,
        "frpMW": 1591.6,
        "acquiredDate": "2024-07-15",
        "satellite": "Aqua",
        "instrument": "MODIS",
        "confidence": "high",
        "scienceValue": 80,
        "sourceUrl": "https://firms.modaps.eosdis.nasa.gov/data/country/modis/2024/modis_2024_Democratic_Republic_of_the_Congo.csv",
    },
    {
        "id": "firms_ao_miombo",
        "name": "Angola Miombo Woodland Thermal Cluster",
        "region": "Africa",
        "lat": -10.66979,
        "lon": 18.25408,
        "brightnessK": 367.0,
        "frpMW": 215.58,
        "acquiredDate": "2024-08-04",
        "satellite": "NOAA-20",
        "instrument": "VIIRS",
        "confidence": "high",
        "scienceValue": 85,
        "sourceUrl": "https://firms.modaps.eosdis.nasa.gov/data/country/viirs-jpss1/2024/viirs-jpss1_2024_Angola.csv",
    },
    {
        "id": "firms_dz_kabylie",
        "name": "Northern Algeria Atlas Forest Spot",
        "region": "Africa",
        "lat": 36.86245,
        "lon": 4.46342,
        "brightnessK": 353.65,
        "frpMW": 12.53,
        "acquiredDate": "2024-07-30",
        "satellite": "Suomi NPP",
        "instrument": "VIIRS",
        "confidence": "nominal",
        "scienceValue": 85,
        "sourceUrl": "https://firms.modaps.eosdis.nasa.gov/data/country/viirs-snpp/2024/viirs-snpp_2024_Algeria.csv",
    },
    {
        "id": "firms_ru_yakutia",
        "name": "Sakha Republic Boreal Taiga Complex",
        "region": "Asia",
        "lat": 62.92365,
        "lon": 124.75309,
        "brightnessK": 332.69,
        "frpMW": 162.23,
        "acquiredDate": "2024-07-09",
        "satellite": "NOAA-20",
        "instrument": "VIIRS",
        "confidence": "nominal",
        "scienceValue": 95,
        "sourceUrl": "https://firms.modaps.eosdis.nasa.gov/data/country/viirs-jpss1/2024/viirs-jpss1_2024_Russian_Federation.csv",
    },
    {
        "id": "firms_ru_buryatia",
        "name": "Northern Buryatia Taiga Wildfire (Muya Valley)",
        "region": "Asia",
        "lat": 56.3021,
        "lon": 115.1315,
        "brightnessK": 500.0,
        "frpMW": 4475.1,
        "acquiredDate": "2024-05-27",
        "satellite": "Terra",
        "instrument": "MODIS",
        "confidence": "high",
        "scienceValue": 85,
        "sourceUrl": "https://firms.modaps.eosdis.nasa.gov/data/country/modis/2024/modis_2024_Russian_Federation.csv",
    },
    {
        "id": "firms_id_kalimantan",
        "name": "Central Kalimantan Peatland Hotspot",
        "region": "Asia",
        "lat": -3.1277,
        "lon": 113.9093,
        "brightnessK": 344.8,
        "frpMW": 43.4,
        "acquiredDate": "2024-09-02",
        "satellite": "Aqua",
        "instrument": "MODIS",
        "confidence": "high",
        "scienceValue": 85,
        "sourceUrl": "https://firms.modaps.eosdis.nasa.gov/data/country/modis/2024/modis_2024_Indonesia.csv",
    },
    {
        "id": "firms_in_uttarakhand",
        "name": "Himalayan Foothills Pine Canopy Fire",
        "region": "Asia",
        "lat": 30.26363,
        "lon": 78.96785,
        "brightnessK": 367.0,
        "frpMW": 59.56,
        "acquiredDate": "2024-05-04",
        "satellite": "Suomi NPP",
        "instrument": "VIIRS",
        "confidence": "high",
        "scienceValue": 85,
        "sourceUrl": "https://firms.modaps.eosdis.nasa.gov/data/country/viirs-snpp/2024/viirs-snpp_2024_India.csv",
    },
    {
        "id": "firms_au_kimberley",
        "name": "Western Australia Kimberley Savanna Front",
        "region": "Oceania",
        "lat": -18.32201,
        "lon": 126.47453,
        "brightnessK": 367.0,
        "frpMW": 96.51,
        "acquiredDate": "2024-10-13",
        "satellite": "NOAA-20",
        "instrument": "VIIRS",
        "confidence": "high",
        "scienceValue": 90,
        "sourceUrl": "https://firms.modaps.eosdis.nasa.gov/data/country/viirs-jpss1/2024/viirs-jpss1_2024_Australia.csv",
    },
    {
        "id": "firms_au_vic_grampians",
        "name": "Victoria Grampians Bushfire Cluster",
        "region": "Oceania",
        "lat": -37.3537,
        "lon": 142.51311,
        "brightnessK": 367.0,
        "frpMW": 554.26,
        "acquiredDate": "2024-12-20",
        "satellite": "Suomi NPP",
        "instrument": "VIIRS",
        "confidence": "high",
        "scienceValue": 100,
        "sourceUrl": "https://firms.modaps.eosdis.nasa.gov/data/country/viirs-snpp/2024/viirs-snpp_2024_Australia.csv",
    },
    {
        "id": "firms_au_nsw_blue",
        "name": "New South Wales Eucalyptus Ridge Spot",
        "region": "Oceania",
        "lat": -33.1086,
        "lon": 150.3739,
        "brightnessK": 414.9,
        "frpMW": 388.6,
        "acquiredDate": "2024-12-29",
        "satellite": "Aqua",
        "instrument": "MODIS",
        "confidence": "high",
        "scienceValue": 90,
        "sourceUrl": "https://firms.modaps.eosdis.nasa.gov/data/country/modis/2024/modis_2024_Australia.csv",
    },
    {
        "id": "firms_us_hi_maui",
        "name": "West Maui Coastal Brush Hotspot",
        "region": "Oceania / Pacific",
        "lat": 20.85503,
        "lon": -156.65543,
        "brightnessK": 344.7,
        "frpMW": 74.91,
        "acquiredDate": "2023-08-09",
        "satellite": "NOAA-20",
        "instrument": "VIIRS",
        "confidence": "nominal",
        "scienceValue": 95,
        "sourceUrl": "https://firms.modaps.eosdis.nasa.gov/data/country/viirs-jpss1/2023/viirs-jpss1_2023_United_States.csv",
    },
    {
        "id": "firms_us_ak_interior",
        "name": "Interior Alaska Yukon Boreal Spot",
        "region": "North America",
        "lat": 65.17679,
        "lon": -148.7368,
        "brightnessK": 353.41,
        "frpMW": 194.5,
        "acquiredDate": "2024-06-28",
        "satellite": "Suomi NPP",
        "instrument": "VIIRS",
        "confidence": "nominal",
        "scienceValue": 90,
        "sourceUrl": "https://firms.modaps.eosdis.nasa.gov/data/country/viirs-snpp/2024/viirs-snpp_2024_United_States.csv",
    },
]


def fetch_firms_live(map_key: str, limit: int = 24) -> list[dict[str, Any]]:
    """Query NASA FIRMS VIIRS_SNPP_NRT global 24h CSV and extract top FRP spots."""
    url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{map_key}/VIIRS_SNPP_NRT/world/1"
    req = urllib.request.Request(url, headers={"User-Agent": "MissionArchitect-SpaceApps/1.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        text = resp.read().decode("utf-8", errors="replace")

    reader = csv.DictReader(io.StringIO(text))
    rows: list[dict[str, Any]] = []
    for idx, row in enumerate(reader):
        try:
            frp = float(row.get("frp") or 0.0)
            bright = float(row.get("bright_ti4") or row.get("brightness") or 330.0)
            lat = float(row["latitude"])
            lon = float(row["longitude"])
        except (KeyError, ValueError):
            continue
        conf_raw = (row.get("confidence") or "n").lower()
        conf = "high" if conf_raw in ("h", "high") else "nominal"
        rows.append(
            {
                "id": f"firms_live_{idx}",
                "name": f"FIRMS Hotspot ({lat:.2f}°, {lon:.2f}°)",
                "region": "Global",
                "lat": round(lat, 3),
                "lon": round(lon, 3),
                "brightnessK": round(bright, 1),
                "frpMW": round(frp, 1),
                "acquiredDate": row.get("acq_date", "2026-11-14"),
                "satellite": row.get("satellite", "Suomi NPP"),
                "instrument": row.get("instrument", "VIIRS"),
                "confidence": conf,
                "scienceValue": 95 if conf == "high" else 80,
                "sourceUrl": "https://firms.modaps.eosdis.nasa.gov/api/area/",
            }
        )

    rows.sort(key=lambda item: item["frpMW"], reverse=True)
    return rows[:limit]


def build_fires_payload(live: bool = False) -> dict[str, Any]:
    map_key = os.environ.get("FIRMS_MAP_KEY", "").strip()
    source_mode = "archived_curated"
    fires = ARCHIVED_FIRES

    if map_key and (live or os.environ.get("FIRMS_USE_LIVE") == "1"):
        try:
            live_rows = fetch_firms_live(map_key)
            if live_rows:
                fires = live_rows
                source_mode = "live_snapshot_archived"
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            print(f"[fetch_firms] Live FIRMS request failed ({exc}); using curated archive.")

    return {
        "dataset": "NASA FIRMS Active Fire Targets (Archived)",
        "archivedDataNotice": ARCHIVED_NOTICE,
        "sourceMode": source_mode,
        "sourceLabel": "NASA FIRMS / LANCE Earthdata (VIIRS & MODIS Active Fire Data)",
        "sourceUrl": "https://firms.modaps.eosdis.nasa.gov/",
        "count": len(fires),
        "fires": fires,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build public/data/fires.json from NASA FIRMS data.")
    parser.add_argument("--live", action="store_true", help="Attempt live fetch using FIRMS_MAP_KEY env var.")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    out_path = root / "public" / "data" / "fires.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    payload = build_fires_payload(live=args.live)
    out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[fetch_firms] Wrote {payload['count']} fire targets -> {out_path} ({payload['sourceMode']})")


if __name__ == "__main__":
    main()
