#!/usr/bin/env python3
"""Fetch or build archived NASA DONKI space weather events for Mission Architect.

Usage:
  uv run data-prep/fetch_donki.py           # Uses curated NASA DONKI archive
  uv run data-prep/fetch_donki.py --live    # Queries api.nasa.gov/DONKI (DEMO_KEY or NASA_API_KEY)
"""

from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.request
from datetime import date, timedelta
from pathlib import Path
from typing import Any

ARCHIVED_NOTICE = (
    "Archived real solar storm records from NASA's Space Weather Database Of "
    "Notifications, Knowledge, Information (CCMC DONKI / api.nasa.gov) — bundled "
    "offline for deterministic simulation, not a live feed."
)

# Curated historical NASA DONKI solar storms from Solar Cycle 25 (2024-2025).
# Verified 2026-11-14 against https://ccmc.gsfc.nasa.gov/DONKI-API/get/{GST,SEP,FLR}:
#   donkiActivityId, startTimeUtc, kpIndex and sourceUrl are copied from DONKI
#   (kpIndex = max of allKpIndex of the event or of the GST DONKI links to it;
#   peakTimeUtc = first 3-hour window at that max Kp, or the flare/proton peak).
#   protonFluxPfu = peak GOES >10 MeV flux from NOAA SWPC's proton event list
#   (ftp://ftp.swpc.noaa.gov/pub/indices/SPE.txt); 0 = stayed below the 10 pfu S1 threshold.
#   safeModeHours, batteryDrainPct, unshieldedFailureProb and missionDayTrigger are
#   game-balance parameters, NOT NASA data.
ARCHIVED_STORMS: list[dict[str, Any]] = [
    {
        "id": "donki_2024_gannon_g5",
        "donkiActivityId": "2024-05-10T15:00:00-GST-001",
        "title": "G5 Extreme Geomagnetic Storm ('Gannon Storm')",
        "startTimeUtc": "2024-05-10T15:00:00Z",
        "peakTimeUtc": "2024-05-11T00:00:00Z",
        "eventType": "GST",
        "kpIndex": 9.0,
        "protonFluxPfu": 207.0,
        "safeModeHours": 6,
        "batteryDrainPct": 18,
        "unshieldedFailureProb": 0.35,
        "missionDayTrigger": 4,
        "description": (
            "Multiple Earth-directed halo CMEs from Active Region AR3664 merged in transit, "
            "triggering the strongest geomagnetic storm (Kp 9) in two decades. Increases LEO "
            "thermospheric drag and forces spacecraft into safe mode."
        ),
        "sourceUrl": "https://ccmc.gsfc.nasa.gov/DONKI/view/GST/30693/-1",
    },
    {
        "id": "donki_2024_mar_sep",
        "donkiActivityId": "2024-03-23T08:15:00-SEP-001",
        "title": "X1.1 Solar Energetic Particle (SEP) Radiation Event",
        "startTimeUtc": "2024-03-23T08:15:00Z",
        "peakTimeUtc": "2024-03-23T18:20:00Z",
        "eventType": "SEP",
        "kpIndex": 8.0,
        "protonFluxPfu": 956.0,
        "safeModeHours": 5,
        "batteryDrainPct": 12,
        "unshieldedFailureProb": 0.45,
        "missionDayTrigger": 7,
        "description": (
            "High-energy solar proton stream (>10 MeV, S2 radiation storm) elevated single-event "
            "upsets in basic flight computers and posed acute radiation dose risk to unshielded "
            "crewed or high-latitude polar missions; its CME drove a Kp 8 storm the next day."
        ),
        "sourceUrl": "https://ccmc.gsfc.nasa.gov/DONKI/view/SEP/29711/-1",
    },
    {
        "id": "donki_2024_oct_x9",
        "donkiActivityId": "2024-10-03T12:08:00-FLR-001",
        "title": "X9.0 Solar Flare & Fast Earth-Directed CME",
        "startTimeUtc": "2024-10-03T12:08:00Z",
        "peakTimeUtc": "2024-10-03T12:18:00Z",
        "eventType": "FLR",
        "kpIndex": 7.33,
        "protonFluxPfu": 0.0,
        "safeModeHours": 4,
        "batteryDrainPct": 14,
        "unshieldedFailureProb": 0.28,
        "missionDayTrigger": 12,
        "description": (
            "Strongest flare of Solar Cycle 25 up to Oct 2024 (X9.0 from AR3842), producing "
            "a halo CME, radio blackouts affecting S-band and X-band ground links, and a "
            "Kp 7.33 geomagnetic storm when the CME arrived on Oct 7-8."
        ),
        "sourceUrl": "https://ccmc.gsfc.nasa.gov/DONKI/view/FLR/33693/-1",
    },
    {
        "id": "donki_2024_oct_g4",
        "donkiActivityId": "2024-10-10T15:00:00-GST-001",
        "title": "G4 Severe Geomagnetic Storm & Polar Radio Absorption",
        "startTimeUtc": "2024-10-10T15:00:00Z",
        "peakTimeUtc": "2024-10-11T00:00:00Z",
        "eventType": "GST",
        "kpIndex": 8.67,
        "protonFluxPfu": 1810.0,
        "safeModeHours": 5,
        "batteryDrainPct": 16,
        "unshieldedFailureProb": 0.4,
        "missionDayTrigger": 18,
        "description": (
            "Fast 1,500 km/s CME arrived at Earth's magnetosphere, driving intense polar "
            "aurora, S3 proton storm conditions, and temporary attitude-sensor blinding."
        ),
        "sourceUrl": "https://ccmc.gsfc.nasa.gov/DONKI/view/GST/33913/-1",
    },
    {
        "id": "donki_2025_jan_g4",
        "donkiActivityId": "2025-01-01T09:00:00-GST-001",
        "title": "New Year G4 Geomagnetic Storm",
        "startTimeUtc": "2025-01-01T09:00:00Z",
        "peakTimeUtc": "2025-01-01T18:00:00Z",
        "eventType": "GST",
        "kpIndex": 8.0,
        "protonFluxPfu": 0.0,
        "safeModeHours": 4,
        "batteryDrainPct": 11,
        "unshieldedFailureProb": 0.25,
        "missionDayTrigger": 24,
        "description": (
            "Double CME impact compressed Earth's magnetopause inside GEO altitude, exposing "
            "high-altitude geostationary spacecraft to surface charging hazards."
        ),
        "sourceUrl": "https://ccmc.gsfc.nasa.gov/DONKI/view/GST/36159/-1",
    },
]


def fetch_donki_live(api_key: str) -> list[dict[str, Any]]:
    """Query NASA DONKI GST endpoint for strong geomagnetic storms (Kp >= 7)."""
    # DONKI rejects ranges over 60 days (HTTP 400), so ask in 60-day windows.
    data: list[dict[str, Any]] = []
    day = date(2024, 5, 1)
    while day < date(2025, 2, 1):
        end = min(day + timedelta(days=59), date(2025, 2, 1))
        url = f"https://api.nasa.gov/DONKI/GST?startDate={day}&endDate={end}&api_key={api_key}"
        req = urllib.request.Request(url, headers={"User-Agent": "MissionArchitect-SpaceApps/1.0"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            data += json.loads(resp.read().decode("utf-8") or "[]")
        day = end + timedelta(days=1)

    storms: list[dict[str, Any]] = []
    trigger_days = [4, 7, 12, 18, 24]
    for item in data:
        kp_entries = item.get("allKpIndex") or []
        max_kp = max((float(entry.get("kpIndex", 0)) for entry in kp_entries), default=0.0)
        if max_kp < 7.0:
            continue
        idx = len(storms)
        if idx >= len(trigger_days):
            break
        peak_time = next(e["observedTime"] for e in kp_entries if float(e.get("kpIndex", 0)) == max_kp)
        storms.append(
            {
                "id": f"donki_live_{idx + 1}",
                "donkiActivityId": item.get("gstID", f"GST-{idx + 1}"),
                "title": f"Geomagnetic Storm (Kp {max_kp:.1f})",
                "startTimeUtc": item.get("startTime", ""),
                "peakTimeUtc": peak_time,
                "eventType": "GST",
                "kpIndex": round(max_kp, 2),
                "protonFluxPfu": 0.0,  # GST records carry no proton flux; don't invent one
                "safeModeHours": 4 if max_kp < 8 else 6,
                "batteryDrainPct": round(10 + max_kp),
                "unshieldedFailureProb": round(min(0.45, max_kp * 0.045), 2),
                "missionDayTrigger": trigger_days[idx],
                "description": (
                    f"Real NASA DONKI geomagnetic storm event {item.get('gstID', '')} "
                    f"reaching Kp {max_kp:.1f}. Forces instruments into safe mode."
                ),
                "sourceUrl": item.get("link", "https://ccmc.gsfc.nasa.gov/tools/DONKI/"),
            }
        )
    return storms


def build_storms_payload(live: bool = False) -> dict[str, Any]:
    api_key = os.environ.get("NASA_API_KEY", "DEMO_KEY").strip() or "DEMO_KEY"
    source_mode = "archived_curated"
    storms = ARCHIVED_STORMS

    if live or os.environ.get("DONKI_USE_LIVE") == "1":
        try:
            live_rows = fetch_donki_live(api_key)
            if live_rows:
                storms = live_rows
                source_mode = "live_snapshot_archived"
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            print(f"[fetch_donki] Live DONKI request failed ({exc}); using curated archive.")

    return {
        "dataset": "NASA CCMC DONKI Solar Storms (Archived)",
        "archivedDataNotice": ARCHIVED_NOTICE,
        "sourceMode": source_mode,
        "sourceLabel": "NASA CCMC DONKI — Space Weather Database Of Notifications, Knowledge, Information",
        "sourceUrl": "https://api.nasa.gov/",
        "count": len(storms),
        "storms": storms,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build public/data/storms.json from NASA DONKI.")
    parser.add_argument("--live", action="store_true", help="Attempt live query to api.nasa.gov/DONKI.")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent.parent
    out_path = root / "public" / "data" / "storms.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    payload = build_storms_payload(live=args.live)
    out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[fetch_donki] Wrote {payload['count']} solar storm records -> {out_path} ({payload['sourceMode']})")


if __name__ == "__main__":
    main()
