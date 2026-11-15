#!/usr/bin/env python3
"""Build public/data/artemis2_trajectory.json from NASA's Artemis II ephemeris.

Source: the Orion state vectors (CCSDS OEM, EME2000, Earth-centred, km and km/s)
that NASA published for Artemis II at
https://www.nasa.gov/missions/artemis-ii/track-nasas-artemis-ii-mission-in-real-time/
("Artemis II Ephemeris" ZIP). We use the newest full file in that ZIP,
Artemis_II_OEM_2026_04_10_Post-ICPS-Sep-to-EI.asc (created 2026-04-10 by
NASA/JSC flight dynamics), which runs from Orion's separation from the upper
stage to entry interface. A copy lives in data-prep/raw/.

The game's Moon moves on a simplified circular orbit, so the real path is
stored in the Earth-Moon rotating frame (x towards the Moon, z along the Moon's
orbit normal). The game turns it back with its own Moon, which keeps the shape
of the trip around the Moon. To build that frame we compute the Moon's
position with a truncated version of the lunar theory in Meeus, Astronomical
Algorithms, ch. 47 (accurate to a few hundredths of a degree and ~100 km),
which is plenty for a drawing and for the closest-approach figure.

Usage:
  uv run data-prep/build_artemis2.py
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OEM_FILE = ROOT / "data-prep" / "raw" / "Artemis_II_OEM_2026_04_10_Post-ICPS-Sep-to-EI.asc"
OUT_FILE = ROOT / "public" / "data" / "artemis2_trajectory.json"

# Checks against NASA's flight-day 6 update (closest approach about 6,545 km
# above the surface, record 406,771 km from Earth, both near 23:00 UTC on 6 April):
# https://www.nasa.gov/blogs/missions/2026/04/06/artemis-ii-flight-day-6-crew-wraps-historic-lunar-flyby/
# This script gives 6,539 km and 406,773 km.

# Liftoff: 6:35 p.m. EDT on 1 April 2026, Launch Complex 39B.
# https://www.nasa.gov/blogs/missions/2026/04/01/live-artemis-ii-launch-day-updates/
LAUNCH_UTC = datetime(2026, 4, 1, 22, 35, 0, tzinfo=timezone.utc)
SOURCE_PAGE = "https://www.nasa.gov/missions/artemis-ii/track-nasas-artemis-ii-mission-in-real-time/"
SOURCE_ZIP = "https://www.nasa.gov/wp-content/uploads/2026/03/all-artemis-ii-oem-files.zip"
LAUNCH_SOURCE = "https://www.nasa.gov/blogs/missions/2026/04/01/live-artemis-ii-launch-day-updates/"

R_EARTH_KM = 6371.0
R_MOON_KM = 1737.4
SAMPLE_EVERY_S = 30 * 60  # keep one point every 30 minutes (and every point near the Moon)
NEAR_MOON_KM = 60000.0

DEG = math.pi / 180.0


# ----------------------------------------------------------------- OEM reader
def read_oem(path: Path) -> tuple[dict[str, str], list[tuple[datetime, list[float]]]]:
    meta: dict[str, str] = {}
    rows: list[tuple[datetime, list[float]]] = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("COMMENT"):
            continue
        if "=" in line:
            k, v = (s.strip() for s in line.split("=", 1))
            meta.setdefault(k, v)
            continue
        parts = line.split()
        if len(parts) == 7 and parts[0][:2] == "20":
            t = datetime.fromisoformat(parts[0]).replace(tzinfo=timezone.utc)
            rows.append((t, [float(x) for x in parts[1:]]))
    assert meta.get("REF_FRAME") == "EME2000", meta.get("REF_FRAME")
    assert meta.get("CENTER_NAME") == "EARTH", meta.get("CENTER_NAME")
    assert meta.get("TIME_SYSTEM") == "UTC", meta.get("TIME_SYSTEM")
    return meta, rows


# ------------------------------------------------------- Moon (Meeus ch. 47)
# (D, M, M', F, coefficient of sin for longitude [1e-6 deg], cos for distance [1e-3 km])
LR_TERMS = [
    (0, 0, 1, 0, 6288774, -20905355), (2, 0, -1, 0, 1274027, -3699111),
    (2, 0, 0, 0, 658314, -2955968), (0, 0, 2, 0, 213618, -569925),
    (0, 1, 0, 0, -185116, 48888), (0, 0, 0, 2, -114332, -3149),
    (2, 0, -2, 0, 58793, 246158), (2, -1, -1, 0, 57066, -152138),
    (2, 0, 1, 0, 53322, -170733), (2, -1, 0, 0, 45758, -204586),
    (0, 1, -1, 0, -40923, -129620), (1, 0, 0, 0, -34720, 108743),
    (0, 1, 1, 0, -30383, 104755), (2, 0, 0, -2, 15327, 10321),
    (0, 0, 1, 2, -12528, 0), (0, 0, 1, -2, 10980, 79661),
    (4, 0, -1, 0, 10675, -34782), (0, 0, 3, 0, 10034, -23210),
    (4, 0, -2, 0, 8548, -21636), (2, 1, -1, 0, -7888, 24208),
    (2, 1, 0, 0, -6766, 30824), (1, 0, -1, 0, -5163, -8379),
    (1, 1, 0, 0, 4987, -16675), (2, -1, 1, 0, 4036, -12831),
    (2, 0, 2, 0, 3994, -10445), (4, 0, 0, 0, 3861, -11650),
    (2, 0, -3, 0, 3665, 14403), (0, 1, -2, 0, -2689, -7003),
    (2, 0, -1, 2, -2602, 0), (2, -1, -2, 0, 2390, 10056),
    (1, 0, 1, 0, -2348, 6322), (2, -2, 0, 0, 2236, -9884),
]
# (D, M, M', F, coefficient of sin for latitude [1e-6 deg])
B_TERMS = [
    (0, 0, 0, 1, 5128122), (0, 0, 1, 1, 280602), (0, 0, 1, -1, 277693),
    (2, 0, 0, -1, 173237), (2, 0, -1, 1, 55413), (2, 0, -1, -1, 46271),
    (2, 0, 0, 1, 32573), (0, 0, 2, 1, 17198), (2, 0, 1, -1, 9266),
    (0, 0, 2, -1, 8822), (2, -1, 0, -1, 8216), (2, 0, -2, -1, 4324),
    (2, 0, 1, 1, 4200), (2, 1, 0, -1, -3359), (2, -1, -1, 1, 2463),
]


def moon_eme2000_km(t: datetime) -> tuple[float, float, float]:
    """Geocentric Moon position, J2000 equator and equinox, km (Meeus ch. 47, truncated)."""
    jd = t.timestamp() / 86400.0 + 2440587.5
    T = (jd - 2451545.0) / 36525.0
    Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T * T
    D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T * T
    M = 357.5291092 + 35999.0502909 * T - 0.0001536 * T * T
    Mp = 134.9633964 + 477198.8675055 * T + 0.0087414 * T * T
    F = 93.2720950 + 483202.0175233 * T - 0.0036539 * T * T
    E = 1 - 0.002516 * T - 0.0000074 * T * T
    sl = sr = sb = 0.0
    for d, m, mp, f, cl, cr in LR_TERMS:
        arg = (d * D + m * M + mp * Mp + f * F) * DEG
        e = E ** abs(m)
        sl += cl * e * math.sin(arg)
        sr += cr * e * math.cos(arg)
    for d, m, mp, f, cb in B_TERMS:
        arg = (d * D + m * M + mp * Mp + f * F) * DEG
        sb += cb * (E ** abs(m)) * math.sin(arg)
    A1 = (119.75 + 131.849 * T) * DEG
    A2 = (53.09 + 479264.290 * T) * DEG
    A3 = (313.45 + 481266.484 * T) * DEG
    sl += 3958 * math.sin(A1) + 1962 * math.sin((Lp - F) * DEG) + 318 * math.sin(A2)
    sb += (-2235 * math.sin(Lp * DEG) + 382 * math.sin(A3) + 175 * math.sin(A1 - F * DEG)
           + 175 * math.sin(A1 + F * DEG) + 127 * math.sin((Lp - Mp) * DEG) - 115 * math.sin((Lp + Mp) * DEG))
    lon_date = Lp + sl / 1e6
    lat = sb / 1e6
    dist = 385000.56 + sr / 1000.0
    # Ecliptic of date -> ecliptic of J2000: remove general precession in longitude.
    lon = (lon_date - (5029.0966 * T) / 3600.0) * DEG
    lat *= DEG
    eps = 23.4392911 * DEG
    x = dist * math.cos(lat) * math.cos(lon)
    y = dist * math.cos(lat) * math.sin(lon)
    z = dist * math.sin(lat)
    return (x, y * math.cos(eps) - z * math.sin(eps), y * math.sin(eps) + z * math.cos(eps))


# ------------------------------------------------------------------- vectors
def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def norm(a):
    return math.sqrt(dot(a, a))


def unit(a):
    n = norm(a)
    return (a[0] / n, a[1] / n, a[2] / n)


def rotating_frame(t: datetime):
    """Unit vectors of the Earth-Moon rotating frame at t, and the Moon's distance (km)."""
    m = moon_eme2000_km(t)
    m2 = moon_eme2000_km(datetime.fromtimestamp(t.timestamp() + 600, tz=timezone.utc))
    vel = sub(m2, m)
    x = unit(m)
    z = unit(cross(m, vel))
    y = cross(z, x)
    return x, y, z, norm(m)


# -------------------------------------------------------------------- build
def main() -> None:
    meta, rows = read_oem(OEM_FILE)

    closest = None  # (altitude km, t)
    farthest = None  # (distance km, t)
    for t, s in rows:
        r = tuple(s[:3])
        alt = norm(sub(r, moon_eme2000_km(t))) - R_MOON_KM
        if closest is None or alt < closest[0]:
            closest = (alt, t)
        d = norm(r)
        if farthest is None or d > farthest[0]:
            farthest = (d, t)
    assert closest and farthest

    points = []
    last_kept = -1e18
    for i, (t, s) in enumerate(rows):
        r = tuple(s[:3])
        tau = (t - LAUNCH_UTC).total_seconds()
        near_moon = norm(sub(r, moon_eme2000_km(t))) < NEAR_MOON_KM
        if i not in (0, len(rows) - 1) and not near_moon and tau - last_kept < SAMPLE_EVERY_S:
            continue
        last_kept = tau
        x, y, z, moon_km = rotating_frame(t)
        points.append([
            round(tau, 1),
            round(dot(r, x), 1),
            round(dot(r, y), 1),
            round(dot(r, z), 1),
            round(moon_km, 1),
        ])

    v_ei = rows[-1][1][3:]
    payload = {
        "dataset": "NASA Artemis II Orion ephemeris (as published)",
        "mission": "Artemis II",
        "description": (
            "Orion's path on Artemis II, the first crewed flight around the Moon since 1972, from "
            "separation from the upper stage to entry interface. Positions are in the Earth-Moon "
            "rotating frame (x towards the Moon, z along the normal of the Moon's orbit), in km."
        ),
        "sourceLabel": "NASA, Track NASA's Artemis II Mission in Real Time (Artemis II Ephemeris ZIP)",
        "sourceUrl": SOURCE_PAGE,
        "sourceFile": OEM_FILE.name,
        "sourceZipUrl": SOURCE_ZIP,
        "oemCreationDate": meta.get("CREATION_DATE"),
        "oemOriginator": meta.get("ORIGINATOR"),
        "oemFrame": meta.get("REF_FRAME"),
        "launchUtc": LAUNCH_UTC.isoformat().replace("+00:00", "Z"),
        "launchSourceUrl": LAUNCH_SOURCE,
        "moonModel": "Meeus, Astronomical Algorithms ch. 47 (truncated), computed in data-prep/build_artemis2.py",
        "summary": {
            "firstPointMissionTimeS": points[0][0],
            "closestMoonAltitudeKm": round(closest[0]),
            "closestMoonMissionTimeS": round((closest[1] - LAUNCH_UTC).total_seconds()),
            "closestMoonUtc": closest[1].isoformat().replace("+00:00", "Z"),
            # Measured from the Earth's surface, as NASA quotes it (406,771 km = 252,756 mi).
            "maxEarthAltitudeKm": round(farthest[0] - R_EARTH_KM),
            "maxEarthDistanceMissionTimeS": round((farthest[1] - LAUNCH_UTC).total_seconds()),
            "entryInterfaceMissionTimeS": round((rows[-1][0] - LAUNCH_UTC).total_seconds()),
            "entryInterfaceUtc": rows[-1][0].isoformat().replace("+00:00", "Z"),
            "entrySpeedKmS": round(norm(v_ei), 2),
        },
        "columns": ["missionTimeS", "xKm", "yKm", "zKm", "moonDistanceKm"],
        "points": points,
    }
    OUT_FILE.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    print(f"wrote {OUT_FILE.relative_to(ROOT)}: {len(points)} points from {len(rows)} OEM rows")
    print(json.dumps(payload["summary"], indent=2))


if __name__ == "__main__":
    main()
