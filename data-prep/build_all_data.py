#!/usr/bin/env python3
"""Generate and validate all NASA Mission Architect datasets in public/data/.

Uses only Python standard library so anyone on the team can re-run cleanly:
    uv run data-prep/build_all_data.py
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

# local imports for each dataset
from fetch_donki import build_storms_payload
from fetch_firms import build_fires_payload

# global constants for orbital mechanics
EARTH_RADIUS_KM = 6371.0
EARTH_MU_KM3_S2 = 398600.4
EARTH_ROTATION_SEC = 86164.0

# orbital mechanics functions

def kepler_period_minutes(radius_km: float, altitude_km: float, mu_km3_s2: float) -> float:
    """Third law of Kepler: T = 2 * pi * sqrt(a^3 / mu)."""
    a = radius_km + altitude_km
    t_sec = 2.0 * math.pi * math.sqrt((a ** 3) / mu_km3_s2)
    return round(t_sec / 60.0, 1)


def cylindrical_eclipse_minutes(
    radius_km: float, altitude_km: float, period_minutes: float
) -> float:
    """Maximum cylindrical shadow time when Sun lies in the orbit plane (beta = 0)."""
    a = radius_km + altitude_km
    ratio = min(1.0, radius_km / a)
    eclipse_fraction = math.asin(ratio) / math.pi
    return round(eclipse_fraction * period_minutes, 1)

# payload builders for each dataset
def build_parts_payload() -> dict[str, Any]:
    parts: list[dict[str, Any]] = [
        # --- Structure ---
        {
            "id": "struct_small",
            "subsystem": "structure",
            "name": "Small MicroSat Bus (12U / ESPA-Class)",
            "tier": "easy",
            "massKg": 28,
            "powerW": -5,
            "costM": 6,
            "dataRateGBPerDay": 0,
            "scienceValue": 0,
            "reliability": 0.94,
            "shapeHint": "bus_sm",
            "hintText": (
                "Compact aluminum-honeycomb chassis ideal for rideshare and small rockets; "
                "saves mass and money but offers less thermal margin."
            ),
            "sourceLabel": "NASA Ames State-of-the-Art of Small Spacecraft Technology (Structures)",
            "sourceUrl": "https://www.nasa.gov/smallsat-institute/sst-soa/",
        },
        {
            "id": "struct_medium",
            "subsystem": "structure",
            "name": "Medium Spacecraft Bus (ESPA-Grande Class)",
            "tier": "easy",
            "massKg": 58,
            "powerW": -10,
            "costM": 14,
            "dataRateGBPerDay": 0,
            "scienceValue": 0,
            "reliability": 0.98,
            "shapeHint": "bus_md",
            "hintText": (
                "Reinforced bus with extra radiation shielding and multi-instrument mounts, "
                "built for high-altitude GEO or deep-space lunar missions."
            ),
            "sourceLabel": "NASA Ames Small Spacecraft Technology — Platform Bus Standards",
            "sourceUrl": "https://www.nasa.gov/smallsat-institute/sst-soa/structures-materials-and-mechanisms/",
        },
        # --- Solar Arrays ---
        {
            "id": "solar_body",
            "subsystem": "solar",
            "name": "Body-Mounted GaAs Solar Panels",
            "tier": "easy",
            "massKg": 6,
            "powerW": 65,
            "costM": 4,
            "dataRateGBPerDay": 0,
            "scienceValue": 0,
            "reliability": 0.98,
            "shapeHint": "panel_body",
            "hintText": (
                "Zero moving parts and virtually impossible to jam after launch, but "
                "limited surface area caps available power at ~65 W."
            ),
            "sourceLabel": "NASA Ames SmallSat SOA — Power (Solar Cells)",
            "sourceUrl": "https://www.nasa.gov/smallsat-institute/sst-soa/power/",
        },
        {
            "id": "solar_deploy",
            "subsystem": "solar",
            "name": "Deployable Twin-Wing Solar Array",
            "tier": "easy",
            "massKg": 16,
            "powerW": 180,
            "costM": 10,
            "dataRateGBPerDay": 0,
            "scienceValue": 0,
            "reliability": 0.95,
            "shapeHint": "panel_deploy",
            "hintText": (
                "Unfolds in orbit to deliver 180 W—enough for high-rate X-band radios and "
                "multiple thermal cameras."
            ),
            "sourceLabel": "NASA Ames SmallSat SOA — Deployable Solar Arrays",
            "sourceUrl": "https://www.nasa.gov/smallsat-institute/sst-soa/power/",
        },
        {
            "id": "solar_rosas",
            "subsystem": "solar",
            "name": "High-Efficiency Gimbaled ROSA Array",
            "tier": "engineer",
            "massKg": 24,
            "powerW": 320,
            "costM": 18,
            "dataRateGBPerDay": 0,
            "scienceValue": 0,
            "reliability": 0.97,
            "shapeHint": "panel_deploy",
            "hintText": (
                "Roll-Out Solar Array with dual-axis sun tracking. Maximizes wattage for "
                "Ka-band links and multi-sensor payloads."
            ),
            "sourceLabel": "NASA Roll-Out Solar Array (ROSA) Technology",
            "sourceUrl": "https://www.nasa.gov/smallsat-institute/sst-soa/power/",
        },
        # --- Battery ---
        {
            "id": "bat_40wh",
            "subsystem": "battery",
            "name": "40 Wh Li-Ion Battery Pack",
            "tier": "easy",
            "massKg": 4,
            "powerW": -2,
            "costM": 3,
            "dataRateGBPerDay": 0,
            "scienceValue": 0,
            "batteryCapacityWh": 40,
            "reliability": 0.95,
            "shapeHint": "bus_sm",
            "hintText": (
                "Light and inexpensive energy storage for low-power LEO satellites, but "
                "struggles during long GEO equinoxes or heavy camera night passes."
            ),
            "sourceLabel": "NASA Ames SmallSat SOA — Energy Storage",
            "sourceUrl": "https://www.nasa.gov/smallsat-institute/sst-soa/power/",
        },
        {
            "id": "bat_120wh",
            "subsystem": "battery",
            "name": "120 Wh Space-Grade Li-Ion Battery",
            "tier": "easy",
            "massKg": 10,
            "powerW": -4,
            "costM": 8,
            "dataRateGBPerDay": 0,
            "scienceValue": 0,
            "batteryCapacityWh": 120,
            "reliability": 0.99,
            "shapeHint": "bus_md",
            "hintText": (
                "Triple the energy reserve so thermal cameras and radios keep working "
                "through Earth or Lunar shadow without browning out."
            ),
            "sourceLabel": "NASA Ames SmallSat SOA — Li-Ion Flight Heritage",
            "sourceUrl": "https://www.nasa.gov/smallsat-institute/sst-soa/power/",
        },
        # --- Communications (Antenna) ---
        {
            "id": "ant_sband",
            "subsystem": "antenna",
            "name": "S-Band Patch Antenna (2.2 GHz)",
            "tier": "easy",
            "massKg": 3,
            "powerW": -14,
            "costM": 4,
            "dataRateGBPerDay": 12,
            "scienceValue": 0,
            "reliability": 0.97,
            "shapeHint": "dish_s",
            "hintText": (
                "Low-power telemetry antenna (~12 GB/day). Works for simple sensors, "
                "but causes memory overflow if paired with high-resolution imagers."
            ),
            "sourceLabel": "NASA Near Space Network (SCaN) — S-Band Links",
            "sourceUrl": "https://www.nasa.gov/smallsat-institute/sst-soa/communications/",
        },
        {
            "id": "ant_xband",
            "subsystem": "antenna",
            "name": "X-Band High-Gain Dish (8.4 GHz)",
            "tier": "easy",
            "massKg": 8,
            "powerW": -38,
            "costM": 12,
            "dataRateGBPerDay": 65,
            "scienceValue": 0,
            "reliability": 0.97,
            "shapeHint": "dish_x",
            "hintText": (
                "Standard Earth-observation downlink (~65 GB/day). Draws more power and "
                "requires accurate pointing, but clears camera memory during short passes."
            ),
            "sourceLabel": "NASA Near Space Network — X-Band Earth Observation",
            "sourceUrl": "https://www.nasa.gov/smallsat-institute/sst-soa/communications/",
        },
        {
            "id": "ant_kaband",
            "subsystem": "antenna",
            "name": "Ka-Band Steerable Phased Array (26 GHz)",
            "tier": "engineer",
            "massKg": 13,
            "powerW": -60,
            "costM": 20,
            "dataRateGBPerDay": 150,
            "scienceValue": 0,
            "reliability": 0.98,
            "shapeHint": "dish_x",
            "hintText": (
                "Ultra-high-bandwidth downlink (150 GB/day) for multi-instrument payloads. "
                "Requires deployable solar wings or ROSA to feed its RF amplifier."
            ),
            "sourceLabel": "NASA SCaN — Ka-Band SmallSat Communications",
            "sourceUrl": "https://www.nasa.gov/smallsat-institute/sst-soa/communications/",
        },
        # --- Onboard Computer ---
        {
            "id": "comp_basic",
            "subsystem": "computer",
            "name": "Basic Flight Computer (32 GB Flash)",
            "tier": "easy",
            "massKg": 4,
            "powerW": -10,
            "costM": 5,
            "dataRateGBPerDay": 0,
            "scienceValue": 0,
            "storageCapacityGB": 32,
            "reliability": 0.91,
            "shapeHint": "bus_sm",
            "hintText": (
                "Affordable C&DH processor with 32 GB buffer. If ground stations drop out "
                "or downlink lags behind, memory fills quickly."
            ),
            "sourceLabel": "NASA Ames SmallSat SOA — Command & Data Handling",
            "sourceUrl": "https://www.nasa.gov/smallsat-institute/sst-soa/small-spacecraft-avionics/",
        },
        {
            "id": "comp_adv",
            "subsystem": "computer",
            "name": "Radiation-Hardened OBC (128 GB SSR)",
            "tier": "engineer",
            "massKg": 7,
            "powerW": -18,
            "costM": 11,
            "dataRateGBPerDay": 0,
            "scienceValue": 0,
            "storageCapacityGB": 128,
            "reliability": 0.99,
            "shapeHint": "bus_md",
            "hintText": (
                "Triple-modular redundant flight computer with 128 GB solid-state recorder; "
                "survives solar particle events and holds days of backlog during outages."
            ),
            "sourceLabel": "NASA Ames SmallSat SOA — Radiation-Tolerant Avionics",
            "sourceUrl": "https://www.nasa.gov/smallsat-institute/sst-soa/small-spacecraft-avionics/",
        },
        # --- Attitude Control (ADCS) ---
        {
            "id": "adcs_mag",
            "subsystem": "attitude",
            "name": "3-Axis Magnetorquers & Sun Sensors",
            "tier": "easy",
            "massKg": 4,
            "powerW": -8,
            "costM": 4,
            "dataRateGBPerDay": 0,
            "scienceValue": 0,
            "reliability": 0.94,
            "shapeHint": "bus_sm",
            "hintText": (
                "Lightweight magnetic coils that push against Earth's magnetic field. "
                "Low power, but lacks the precision pointing needed in GEO or Moon orbits."
            ),
            "sourceLabel": "NASA Ames SmallSat SOA — Guidance, Navigation & Control",
            "sourceUrl": "https://www.nasa.gov/smallsat-institute/sst-soa/guidance-navigation-and-control/",
        },
        {
            "id": "adcs_wheels",
            "subsystem": "attitude",
            "name": "Reaction Wheels + Dual Star Trackers",
            "tier": "easy",
            "massKg": 10,
            "powerW": -20,
            "costM": 10,
            "dataRateGBPerDay": 0,
            "scienceValue": 0,
            "reliability": 0.98,
            "shapeHint": "bus_md",
            "hintText": (
                "Precision pointing stability (<0.01°) for sharp thermal maps, high-gain "
                "X-band dishes, and lunar polar targeting where magnetic fields are absent."
            ),
            "sourceLabel": "NASA Ames SmallSat SOA — Precision ADCS",
            "sourceUrl": "https://www.nasa.gov/smallsat-institute/sst-soa/guidance-navigation-and-control/",
        },
        # --- Scientific Instruments ---
        {
            "id": "inst_tir_viirs",
            "subsystem": "instrument",
            "name": "Thermal Infrared Imager (VIIRS / MODIS Class)",
            "tier": "easy",
            "massKg": 26,
            "powerW": -40,
            "costM": 18,
            "dataRateGBPerDay": -24,
            "scienceValue": 45,
            "angularResRad": 0.00075,
            "targetBodies": ["earth"],
            "reliability": 0.96,
            "shapeHint": "sensor",
            "hintText": (
                "Detects active fire heat signatures day and night in 3.7–11 µm infrared "
                "bands (0.53 km ground pixel at 700 km SSO). Generates 24 GB/day."
            ),
            "sourceLabel": "NASA MODIS / VIIRS Thermal Anomalies & Fire Specs",
            "sourceUrl": "https://www.earthdata.nasa.gov/data/tools/firms/faq",
        },
        {
            "id": "inst_vis_cam",
            "subsystem": "instrument",
            "name": "Visible / NIR Pushbroom Camera",
            "tier": "easy",
            "massKg": 14,
            "powerW": -22,
            "costM": 10,
            "dataRateGBPerDay": -32,
            "scienceValue": 30,
            "angularResRad": 0.0005,
            "targetBodies": ["earth", "moon"],
            "reliability": 0.95,
            "shapeHint": "sensor",
            "hintText": (
                "High-resolution daytime smoke & burn-scar camera (0.20 km at LEO, 0.35 km "
                "at SSO), but generates 32 GB/day—outstripping an S-band radio."
            ),
            "sourceLabel": "NASA MODIS — 250-500 m Visible/NIR Bands (reference imager)",
            "sourceUrl": "https://www.earthdata.nasa.gov/data/instruments/modis",
        },
        {
            "id": "inst_wide_imager",
            "subsystem": "instrument",
            "name": "Wide-Field GEO Fire-Watch Telescope",
            "tier": "engineer",
            "massKg": 40,
            "powerW": -48,
            "costM": 20,
            "dataRateGBPerDay": -18,
            "scienceValue": 40,
            "angularResRad": 0.000026,
            "targetBodies": ["earth"],
            "reliability": 0.97,
            "shapeHint": "sensor",
            "hintText": (
                "Narrow-IFOV cooled telescope engineered specifically for 35,786 km GEO "
                "altitude, achieving 0.93 km ground resolution for continuous fire watch."
            ),
            "sourceLabel": "NASA / NOAA GOES-R ABI & GEO Fire Detection Heritage",
            "sourceUrl": "https://www.nesdis.noaa.gov/our-satellites/currently-flying/goes-east-west/advanced-baseline-imager-abi",
        },
        {
            "id": "inst_spectrometer",
            "subsystem": "instrument",
            "name": "IR / Lyman-Alpha Volatiles Spectrometer",
            "tier": "engineer",
            "massKg": 20,
            "powerW": -32,
            "costM": 16,
            "dataRateGBPerDay": -16,
            "scienceValue": 42,
            "angularResRad": 0.001,
            "targetBodies": ["earth", "moon"],
            "reliability": 0.96,
            "shapeHint": "sensor",
            "hintText": (
                "Maps smoke aerosols on Earth or UV reflectance of water frost inside "
                "permanently shadowed lunar craters (modeled on NASA LRO LAMP)."
            ),
            "sourceLabel": "NASA LRO LAMP / CrIS Spectrometer Heritage",
            "sourceUrl": "https://science.nasa.gov/mission/lro/",
        },
        {
            "id": "inst_neutron_diviner",
            "subsystem": "instrument",
            "name": "Polar Epithermal Neutron & Thermal Mapper",
            "tier": "easy",
            "massKg": 24,
            "powerW": -30,
            "costM": 20,
            "dataRateGBPerDay": -14,
            "scienceValue": 50,
            "angularResRad": 0.0012,
            "targetBodies": ["moon"],
            "reliability": 0.98,
            "shapeHint": "sensor",
            "hintText": (
                "Detects buried hydrogen/water ice (<110 K cold traps) in dark polar "
                "craters without sunlight (modeled on NASA LRO LEND & Diviner)."
            ),
            "sourceLabel": "NASA LRO LEND & Diviner Polar Volatiles Instruments",
            "sourceUrl": "https://science.nasa.gov/mission/lro/",
        },
    ]

    reference_designs = [
        {
            "id": "wildfire_sso_balanced",
            "scenarioId": "wildfire_watch",
            "label": "Balanced Sun-Synchronous Satellite (SSO + Small Rocket)",
            "orbitId": "sso",
            "rocketId": "small",
            "satellites": 1,
            "partIds": [
                "struct_small",
                "solar_deploy",
                "bat_120wh",
                "ant_xband",
                "comp_basic",
                "adcs_wheels",
                "inst_tir_viirs",
            ],
        },
        {
            "id": "wildfire_geo_continuous",
            "scenarioId": "wildfire_watch",
            "label": "Continuous Geostationary Watcher (GEO + Medium Rocket)",
            "orbitId": "geo",
            "rocketId": "medium",
            "satellites": 1,
            "partIds": [
                "struct_medium",
                "solar_deploy",
                "bat_120wh",
                "ant_xband",
                "comp_basic",
                "adcs_wheels",
                "inst_wide_imager",
            ],
        },
        {
            "id": "wildfire_leo_constellation",
            "scenarioId": "wildfire_watch",
            "label": "Dual Low-Cost LEO Satellites (LEO + Rideshare)",
            "orbitId": "leo",
            "rocketId": "rideshare",
            "satellites": 2,
            "partIds": [
                "struct_small",
                "solar_deploy",
                "bat_120wh",
                "ant_xband",
                "comp_basic",
                "adcs_mag",
                "inst_vis_cam",
            ],
        },
        {
            "id": "ice_hunter_lunar_polar",
            "scenarioId": "ice_hunter",
            "label": "Lunar Polar Ice Hunter (LLO Polar + Medium Rocket)",
            "orbitId": "lunar_polar",
            "rocketId": "medium",
            "satellites": 1,
            "partIds": [
                "struct_medium",
                "solar_deploy",
                "bat_120wh",
                "ant_xband",
                "comp_adv",
                "adcs_wheels",
                "inst_neutron_diviner",
                "inst_spectrometer",
            ],
        },
    ]

    return {
        "dataset": "Mission Architect Spacecraft Subsystem Catalog",
        "archivedDataNotice": (
            "Reference component masses, power budgets, data rates, and costs calibrated from "
            "NASA Ames State-of-the-Art of Small Spacecraft Technology, MODIS/VIIRS, LRO, and SCaN "
            "open publications."
        ),
        "sources": [
            {
                "label": "NASA Ames — State-of-the-Art of Small Spacecraft Technology",
                "url": "https://www.nasa.gov/smallsat-institute/sst-soa/",
            },
            {
                "label": "NASA EOS — MODIS & VIIRS Active Fire Instrument Reference",
                "url": "https://www.earthdata.nasa.gov/data/tools/firms/faq",
            },
            {
                "label": "NASA LRO — Diviner, LEND & LAMP Lunar Polar Instruments",
                "url": "https://science.nasa.gov/mission/lro/",
            },
        ],
        "parts": parts,
        "referenceDesigns": reference_designs,
    }


def build_rockets_payload() -> dict[str, Any]:
    rockets = [
        {
            "id": "small",
            "name": "Small Launcher (Electron Class)",
            "vehicleInspiration": "Rocket Lab Electron",
            "costM": 8,
            "maxPayloadKg": {
                "leo": 300,
                "sso": 200,
                "geo": None,
                "lunar_polar": None,
            },
            "hintText": (
                "Dedicated low-cost rocket ($8M) for lightweight satellites up to 200 kg in SSO. "
                "Cannot reach Geostationary Transfer Orbit or the Moon."
            ),
            "sourceLabel": "Rocket Lab Electron Payload User's Guide / NASA VADR",
            "sourceUrl": "https://www.nasa.gov/vadr-venture-class-acquisition-of-dedicated-and-rideshare-launch-services/",
        },
        {
            "id": "medium",
            "name": "Medium Launcher (Falcon 9 Class)",
            "vehicleInspiration": "SpaceX Falcon 9 (Reusable)",
            "costM": 70,
            "maxPayloadKg": {
                "leo": 14460,  # NASA LSP: 400 km / 51.6 deg, drone-ship recovery
                "sso": 11030,  # NASA LSP: 700 km sun-synchronous
                "geo": 5500,  # to GTO; the satellite circularizes itself
                "lunar_polar": 3425,  # NASA LSP: C3 = -1 km2/s2
            },
            "hintText": (
                "Workhorse medium-lift rocket ($70M) capable of sending heavy observatories to "
                "geostationary transfer orbit (GTO) or trans-lunar injection."
            ),
            "sourceLabel": "NASA Launch Services Program (LSP) Performance Web Portal",
            "sourceUrl": "https://elvperf.ksc.nasa.gov/",
        },
        {
            "id": "heavy",
            "name": "Heavy Launcher (Falcon Heavy Class)",
            "vehicleInspiration": "SpaceX Falcon Heavy",
            "costM": 150,
            "maxPayloadKg": {
                "leo": 60000,
                "sso": 40000,
                "geo": 26700,  # to GTO, expendable
                "lunar_polar": 15310,  # NASA LSP: C3 = -1 km2/s2, expendable
            },
            "hintText": (
                "Maximum payload margin ($150M) for massive deep-space or multi-ton missions, "
                "though it consumes the entire Wildfire Watch budget on its own."
            ),
            "sourceLabel": "NASA LSP — Heavy-Lift Launch Vehicle Capabilities",
            "sourceUrl": "https://elvperf.ksc.nasa.gov/",
        },
        {
            "id": "rideshare",
            "name": "Rideshare Slot ($6M / 100 kg)",
            "vehicleInspiration": "NASA CSLI / Transporter Rideshare",
            "costM": 6,
            "costPer100KgM": 6,
            "maxPayloadKg": {
                "leo": 400,
                "sso": 300,
                "geo": None,
                "lunar_polar": None,
            },
            "hintText": (
                "Most affordable way to reach LEO or SSO ($6M per 100 kg) by sharing a fairing "
                "on fixed launch dates. Cannot insert into GEO or Lunar orbit."
            ),
            "sourceLabel": "NASA CubeSat Launch Initiative (CSLI) & VADR Rideshare",
            "sourceUrl": "https://www.nasa.gov/kennedy/launch-services-program/cubesat-launch-initiative/",
        },
    ]
    for rocket in rockets:  # every lunar orbit starts from the same trans-lunar injection
        cap = rocket["maxPayloadKg"]
        cap["lunar_frozen"] = cap["lunar_equatorial"] = cap["lunar_polar"]
    return {
        "dataset": "Mission Architect Launch Vehicle Catalog",
        "archivedDataNotice": (
            "Representative launch vehicle cost and orbital payload envelopes based on NASA "
            "Launch Services Program (LSP) & VADR open reference figures."
        ),
        "rockets": rockets,
    }


def build_stations_payload() -> dict[str, Any]:
    stations = [
        {
            "id": "nsn_wallops",
            "name": "NASA Wallops Flight Facility (Virginia)",
            "network": "NASA Near Space Network (NSN)",
            "lat": 37.9249,
            "lon": -75.4765,
            "minElevationDeg": 5,
            "supportedBands": ["S", "X"],
            "maxDownlinkGBPerPass": 45,
            "sourceLabel": "NASA SCaN Near Space Network",
            "sourceUrl": "https://www.nasa.gov/technology/space-comms/near-space-network-complexes/",
        },
        {
            "id": "nsn_white_sands",
            "name": "NASA White Sands Complex (New Mexico)",
            "network": "NASA Near Space Network (NSN)",
            "lat": 32.5047,
            "lon": -106.6108,
            "minElevationDeg": 5,
            "supportedBands": ["S", "Ka"],
            "maxDownlinkGBPerPass": 55,
            "sourceLabel": "NASA SCaN Near Space Network",
            "sourceUrl": "https://www.nasa.gov/technology/space-comms/near-space-network-complexes/",
        },
        {
            "id": "nsn_svalbard",
            "name": "Svalbard Polar Station (Norway)",
            "network": "NASA Near Space Network / KSAT",
            "lat": 78.2297,
            "lon": 15.4081,
            "minElevationDeg": 5,
            "supportedBands": ["S", "X"],
            "maxDownlinkGBPerPass": 80,
            "sourceLabel": "NASA SCaN Polar Ground Architecture",
            "sourceUrl": "https://www.nasa.gov/technology/space-comms/near-space-network-complexes/",
        },
        {
            "id": "nsn_fairbanks",
            "name": "Alaska Satellite Facility / Fairbanks",
            "network": "NASA Near Space Network (NSN)",
            "lat": 64.8587,
            "lon": -147.8576,
            "minElevationDeg": 5,
            "supportedBands": ["S", "X"],
            "maxDownlinkGBPerPass": 70,
            "sourceLabel": "NASA Earthdata / ASF Ground Station",
            "sourceUrl": "https://asf.alaska.edu/",
        },
        {
            "id": "nsn_mcmurdo",
            "name": "McMurdo Ground Station (Antarctica)",
            "network": "NASA Near Space Network (NSN)",
            "lat": -77.8391,
            "lon": 166.6671,
            "minElevationDeg": 5,
            "supportedBands": ["S", "X"],
            "maxDownlinkGBPerPass": 75,
            "sourceLabel": "NASA SCaN Antarctic Polar Link",
            "sourceUrl": "https://www.nasa.gov/technology/space-comms/near-space-network-complexes/",
        },
        {
            "id": "nsn_santiago",
            "name": "Santiago Ground Station (Chile)",
            "network": "NASA Near Space Network / SSC",
            "lat": -33.1511,
            "lon": -70.6664,
            "minElevationDeg": 5,
            "supportedBands": ["S"],
            "maxDownlinkGBPerPass": 45,
            "sourceLabel": "NASA SCaN Southern Hemisphere Support",
            "sourceUrl": "https://www.nasa.gov/technology/space-comms/near-space-network-complexes/",
        },
        {
            "id": "nsn_dongara",
            "name": "Dongara Station (Western Australia)",
            "network": "NASA Near Space Network / SSC",
            "lat": -29.0457,
            "lon": 115.3487,
            "minElevationDeg": 5,
            "supportedBands": ["S", "X"],
            "maxDownlinkGBPerPass": 50,
            "sourceLabel": "NASA SCaN Indo-Pacific Coverage",
            "sourceUrl": "https://www.nasa.gov/technology/space-comms/near-space-network-complexes/",
        },
        {
            "id": "dsn_goldstone",
            "name": "NASA DSN Goldstone (California)",
            "network": "NASA Deep Space Network (DSN)",
            "lat": 35.4267,
            "lon": -116.89,
            "minElevationDeg": 10,
            "supportedBands": ["S", "X"],
            "maxDownlinkGBPerPass": 90,
            "sourceLabel": "NASA Deep Space Network",
            "sourceUrl": "https://www.nasa.gov/communicating-with-missions/dsn/",
        },
        {
            "id": "dsn_madrid",
            "name": "NASA DSN Madrid (Spain)",
            "network": "NASA Deep Space Network (DSN)",
            "lat": 40.4314,
            "lon": -4.2481,
            "minElevationDeg": 10,
            "supportedBands": ["S", "X"],
            "maxDownlinkGBPerPass": 90,
            "sourceLabel": "NASA Deep Space Network",
            "sourceUrl": "https://www.nasa.gov/communicating-with-missions/dsn/",
        },
        {
            "id": "dsn_canberra",
            "name": "NASA DSN Canberra (Australia)",
            "network": "NASA Deep Space Network (DSN)",
            "lat": -35.4014,
            "lon": 148.9817,
            "minElevationDeg": 10,
            "supportedBands": ["S", "X"],
            "maxDownlinkGBPerPass": 90,
            "sourceLabel": "NASA Deep Space Network",
            "sourceUrl": "https://www.nasa.gov/communicating-with-missions/dsn/",
        },
    ]
    return {
        "dataset": "NASA SCaN Near Space & Deep Space Network Ground Stations",
        "archivedDataNotice": (
            "Real NASA Near Space Network (NSN) and Deep Space Network (DSN) ground station "
            "coordinates used to compute orbital downlink windows. NSN: NASA NEN Users' Guide "
            "453-NENUG Rev 4, Table 2-1; DSN: eyes.nasa.gov/dsn/config.xml. maxDownlinkGBPerPass "
            "is a game-balance value."
        ),
        "stations": stations,
    }

# payload builders for celestial bodies and scenarios

def build_earth_body_payload(stations_payload: dict[str, Any]) -> dict[str, Any]:
    nsn_stations = [s for s in stations_payload["stations"] if "Near Space" in s["network"]]
    return {
        "id": "earth",
        "name": "Earth",
        "radiusKm": EARTH_RADIUS_KM,
        "muKm3s2": EARTH_MU_KM3_S2,
        "rotationPeriodSec": EARTH_ROTATION_SEC,
        "textureUrl": "procedural",
        "hasAtmosphereDrag": True,
        "archivedDataNotice": (
            "Real Earth geophysical constants (NASA NSSDCA), NASA SCaN ground station locations, "
            "and archived NASA FIRMS & DONKI datasets. 3D Earth surface is rendered procedurally by GLSL shaders."
        ),
        "scenario": {
            "id": "wildfire_watch",
            "title": "Wildfire Watch (Earth)",
            "celestialBodyId": "earth",
            "goal": (
                "Detect emerging wildfires worldwide early enough for emergency responders "
                "while keeping costs, power, and data downlink balanced over a 3-year mission."
            ),
            "requirements": {
                "budgetM": 150,
                "missionDurationYears": 3,
                "missionDurationDays": 1095,
                "maxRevisitHours": 12,
                "maxGroundResolutionKm": 1.0,
                "minTargetsDetected": 14,
            },
            "rocketPayloadMultiplier": 1.0,
            "educationalNote": (
                "No single orbit wins at everything: LEO brings crisp resolution and cheap launches "
                "but suffers drag; SSO gives reliable daily global lighting; GEO never leaves a fire "
                "region out of sight but sits 35,786 km away and demands a Medium rocket."
            ),
        },
        "groundStations": nsn_stations,
        "sources": [
            {
                "label": "NASA NSSDCA Earth Fact Sheet",
                "url": "https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html",
            },
            {
                "label": "NASA FIRMS Active Fire Data",
                "url": "https://firms.modaps.eosdis.nasa.gov/",
            },
            {
                "label": "NASA SCaN Near Space Network",
                "url": "https://www.nasa.gov/technology/space-comms/near-space-network-complexes/",
            },
        ],
    }

def build_earth_orbits_payload() -> list[dict[str, Any]]:
    leo_t = kepler_period_minutes(EARTH_RADIUS_KM, 400.0, EARTH_MU_KM3_S2)
    leo_ec = cylindrical_eclipse_minutes(EARTH_RADIUS_KM, 400.0, leo_t)

    sso_t = kepler_period_minutes(EARTH_RADIUS_KM, 700.0, EARTH_MU_KM3_S2)
    sso_ec = cylindrical_eclipse_minutes(EARTH_RADIUS_KM, 700.0, sso_t)

    geo_t = kepler_period_minutes(EARTH_RADIUS_KM, 35786.0, EARTH_MU_KM3_S2)
    geo_ec = cylindrical_eclipse_minutes(EARTH_RADIUS_KM, 35786.0, geo_t)

    return [
        {
            "orbitId": "leo",
            "name": "Low Earth Orbit (LEO · 400 km)",
            "altitudeKm": 400,
            "inclinationDeg": 51.6,
            "periodMinutes": leo_t,
            "eclipseMinutes": leo_ec,
            "revisitHours": 8.5,
            "groundResolutionKm": 0.2,
            "contactMinutesPerDay": 44,
            "expectedLifetimeYears": 2.0,
            "coversBothPoles": False,
            "goodAt": (
                "Very sharp ground detail (0.2–0.3 km) and inexpensive launches via Small or "
                "Rideshare slots; two cheap satellites achieve fast revisit."
            ),
            "badAt": (
                "Residual upper-atmosphere drag limits a single satellite's life to ~2 years "
                "(especially during solar storms) and ground station passes are brief."
            ),
            "hintText": (
                "At 400 km you circle Earth every ~92 minutes—great zoom and cheap rockets, "
                "but pair with a second satellite or watch atmospheric drag!"
            ),
            "sourceLabel": "NASA Orbital Debris / Thermospheric Drag at 400 km",
            "sourceUrl": "https://orbitaldebris.jsc.nasa.gov/",
        },
        {
            "orbitId": "sso",
            "name": "Sun-Synchronous Orbit (SSO · 700 km)",
            "altitudeKm": 700,
            "inclinationDeg": 98.2,
            "periodMinutes": sso_t,
            "eclipseMinutes": sso_ec,
            "revisitHours": 11.5,
            "groundResolutionKm": 0.525,
            "contactMinutesPerDay": 78,
            "expectedLifetimeYears": 7.0,
            "coversBothPoles": True,
            "goodAt": (
                "Crosses every latitude at the same local solar time with global coverage, "
                "7+ year lifetime, and frequent passes over Svalbard and Alaska polar stations."
            ),
            "badAt": (
                "Higher altitude than 400 km LEO reduces rocket mass limit slightly and takes "
                "~11.5 hours between repeat observations for a single satellite."
            ),
            "hintText": (
                "Real NASA fire-watching satellites like Suomi NPP and Aqua fly in Sun-Synchronous "
                "Orbit to compare wildfires under consistent daily lighting."
            ),
            "sourceLabel": "NASA Earth Observatory — Catalog of Earth Satellite Orbits (SSO)",
            "sourceUrl": "https://earthobservatory.nasa.gov/features/OrbitsCatalog",
        },
        {
            "orbitId": "geo",
            "name": "Geostationary Orbit (GEO · 35,786 km)",
            "altitudeKm": 35786,
            "inclinationDeg": 0.0,
            "periodMinutes": geo_t,
            "eclipseMinutes": geo_ec,
            "revisitHours": 0.25,
            "groundResolutionKm": 0.93,
            "contactMinutesPerDay": 1440,
            "expectedLifetimeYears": 15.0,
            "coversBothPoles": False,
            "goodAt": (
                "Matches Earth's rotation to hover continuously over one hemisphere—spot fires "
                "within minutes and enjoy 24/7 continuous ground contact."
            ),
            "badAt": (
                "35,786 km altitude demands a Medium rocket ($70M), a large 120 Wh battery for "
                "69-minute equinox eclipses, and a specialized telescope to stay under 1 km resolution."
            ),
            "hintText": (
                "GEO requires a Medium (Falcon 9 class) rocket and the Wide-Field GEO Telescope; "
                "standard LEO cameras become ~27 km blurry from this high up!"
            ),
            "sourceLabel": "NASA Earth Observatory — Geostationary Orbit Mechanics",
            "sourceUrl": "https://earthobservatory.nasa.gov/features/OrbitsCatalog",
        },
    ]


def build_scenarios_payload() -> dict[str, Any]:
    return {
        "dataset": "Mission Architect Scenarios",
        "scenarios": [
            {
                "id": "wildfire_watch",
                "title": "Wildfire Watch (Earth)",
                "celestialBodyId": "earth",
                "status": "mvp",
                "goal": (
                    "Detect emerging wildfires worldwide early with <= 1 km thermal resolution "
                    "and <= 12 h revisit within a $150M budget."
                ),
                "requirements": {
                    "budgetM": 150,
                    "missionDurationYears": 3,
                    "missionDurationDays": 1095,
                    "maxRevisitHours": 12,
                    "maxGroundResolutionKm": 1.0,
                    "minTargetsDetected": 14,
                },
                "educationalNote": (
                    "At least three distinct architectures can pass: (1) Balanced SSO satellite, "
                    "(2) Continuous GEO observatory, or (3) Dual low-cost LEO satellites."
                ),
                "bodyConfigUrl": "/data/earth_body.json",
                "orbitsUrl": "/data/earth_orbits.json",
                "targetsUrl": "/data/fires.json",
            },
            {
                "id": "ice_hunter",
                "title": "Ice Hunter (Moon)",
                "celestialBodyId": "moon",
                "status": "stretch",
                "goal": (
                    "Map water-ice deposits inside Permanently Shadowed Regions (PSRs) at both "
                    "lunar poles to support Artemis habitats."
                ),
                "requirements": {
                    "budgetM": 300,
                    "missionDurationYears": 1,
                    "missionDurationDays": 365,
                    "requireBothPoles": True,
                    "minInclinationDeg": 85,
                    "maxGroundResolutionKm": 0.5,
                    "minTargetsDetected": 8,
                },
                "educationalNote": (
                    "No magnetic field means magnetorquers don't work on the Moon—pack reaction "
                    "wheels and choose a high-inclination polar or frozen orbit."
                ),
                "bodyConfigUrl": "/data/moon/moon_body.json",
                "orbitsUrl": "/data/moon/moon_orbits.json",
                "targetsUrl": "/data/moon/moon_targets.json",
            },
            {
                "id": "dust_storm_tracker",
                "title": "Dust Storm Tracker (Mars)",
                "celestialBodyId": "mars",
                "status": "stretch",
                "goal": "Monitor planet-encircling dust storms across Mars over a 2-year mission.",
                "requirements": {
                    "budgetM": 450,
                    "missionDurationYears": 2,
                    "missionDurationDays": 730,
                    "maxRevisitHours": 24,
                    "maxGroundResolutionKm": 2.0,
                    "minTargetsDetected": 10,
                },
                "educationalNote": (
                    "Future expansion scenario demonstrating deep-space latency and reduced solar "
                    "irradiance (~43% of Earth) at 1.52 AU."
                ),
            },
            {
                "id": "artemis_lunar_return",
                "title": "Lunar Orbit and Return (Crewed Prototype)",
                "celestialBodyId": "moon",
                "status": "mvp",
                "goal": (
                    "Assemble an Orion-class crew spacecraft and launch vehicle capable of carrying "
                    "4 astronauts around the Moon and safely home."
                ),
                "requirements": {
                    "budgetM": 3200,
                    "missionDurationYears": 0.02,
                    "missionDurationDays": 8,
                    "minTargetsDetected": 1,
                },
                "educationalNote": (
                    "Crewed lunar prototype showcasing life-support consumables, radiation storm "
                    "shelters, and trans-lunar injection payload limits."
                ),
                "bodyConfigUrl": "/data/moon/moon_body.json",
                "partsUrl": "/data/crewed_lunar.json",
            },
        ],
    }


def build_crewed_lunar_payload() -> dict[str, Any]:
    """Real NASA reference values for the crewed Orion / Artemis FlightSim on main."""
    return {
        "dataset": "NASA Orion / Artemis Crewed Lunar & Launch Vehicle Reference Data",
        "archivedDataNotice": (
            "Sourced public engineering figures from NASA Orion, ESA European Service Module (ESM), "
            "NASA Space Launch System (SLS), SpaceX Falcon Heavy / Falcon 9, and ULA Vulcan Centaur "
            "reference sheets. Additive part masses are split to avoid double-counting solar wings and "
            "consumables already bundled in Orion/ESM gross weights; FlightSim stage parameters preserve "
            "real Isp/engine ratios scaled to the procedural 3D rocket stack."
        ),
        "missionRequirements": {
            "name": "Artemis-Class Lunar Orbit and Return",
            "durationDays": 8,
            "extendedDurationDays": 21,
            "crewCount": 4,
            "budgetMUsd": 3200,
        },
        "parts": [
            {
                "id": "capsule",
                "name": "Orion-Class Crew Module (CM)",
                "category": "crew",
                "massKg": 9300,
                "powerW": -1800,
                "costMUsd": 950,
                "oxygenDays": 2,
                "notes": (
                    "Orion CM dry/crew baseline (~9,300 kg dry; ~10,387 kg liftoff with internal "
                    "consumables & cargo), Avcoat heat shield, 4 crew capacity."
                ),
                "sourceLabel": "NASA Orion Spacecraft Overview & Fact Sheet",
                "sourceUrl": "https://www.nasa.gov/humans-in-space/orion-spacecraft/",
            },
            {
                "id": "serviceSmall",
                "name": "Service Module — Flyby Propellant Load",
                "category": "propulsion",
                "massKg": 9480,
                "propellantKg": 3500,
                "powerW": -320,
                "costMUsd": 320,
                "oxygenDays": 0,
                "notes": (
                    "~5,980 kg bare ESM structure/AJ10-190 + 3,500 kg hypergolic propellant: enough "
                    "for free-return flyby on Medium launcher, insufficient for lunar orbit insertion."
                ),
                "sourceLabel": "ESA / NASA European Service Module (ESM) Reference",
                "sourceUrl": "https://www.esa.int/Science_Exploration/Human_and_Robotic_Exploration/Orion/European_Service_Module",
            },
            {
                "id": "serviceLarge",
                "name": "European Service Module (ESM) — Full Lunar Load",
                "category": "propulsion",
                "massKg": 14580,
                "propellantKg": 9000,
                "powerW": -380,
                "costMUsd": 460,
                "oxygenDays": 0,
                "notes": (
                    "~5,580 kg bare ESM bus/AJ10-190/tanks + 9,000 kg MON/MMH propellant (excluding "
                    "480 kg solar wings counted separately; full Orion CM+ESM TLI stack ~26,520 kg)."
                ),
                "sourceLabel": "ESA / NASA Orion ESM Technical Specifications",
                "sourceUrl": "https://www.esa.int/Science_Exploration/Human_and_Robotic_Exploration/Orion/European_Service_Module",
            },
            {
                "id": "lifeSupport7",
                "name": "ECLSS Consumables (7-Day Nominal)",
                "category": "lifeSupport",
                "massKg": 680,
                "powerW": -620,
                "costMUsd": 85,
                "oxygenDays": 7,
                "notes": "O2, N2, potable water, and amine CO2 scrubbers for 4 crew (~1 week; 9 days w/ CM reserve).",
                "sourceLabel": "NASA Orion Spacecraft Overview",
                "sourceUrl": "https://www.nasa.gov/humans-in-space/orion-spacecraft/",
            },
            {
                "id": "lifeSupport14",
                "name": "ECLSS Consumables (14-Day Extended Margin)",
                "category": "lifeSupport",
                "massKg": 1280,
                "powerW": -720,
                "costMUsd": 145,
                "oxygenDays": 14,
                "notes": "Extended O2, water, and CO2 scrubbing consumables supporting 14–21 day Artemis profiles.",
                "sourceLabel": "NASA Orion Spacecraft Overview",
                "sourceUrl": "https://www.nasa.gov/humans-in-space/orion-spacecraft/",
            },
            {
                "id": "solarPanels",
                "name": "ESM 4-Wing X-Configuration Solar Arrays",
                "category": "power",
                "massKg": 480,
                "powerW": 11200,
                "costMUsd": 65,
                "oxygenDays": 0,
                "notes": "Four 7-meter deployable solar wings generating ~11.2 kW at 1 AU.",
                "sourceLabel": "ESA / Airbus Orion ESM Solar Array Specs",
                "sourceUrl": "https://www.esa.int/Science_Exploration/Human_and_Robotic_Exploration/Orion/European_Service_Module",
            },
            {
                "id": "radiationShield",
                "name": "Crew Radiation Storm Shelter & HERA Dosimetry",
                "category": "protection",
                "massKg": 850,
                "powerW": -40,
                "costMUsd": 125,
                "oxygenDays": 0,
                "notes": (
                    "Hydrogen-rich radiation shelter stowage kit + NASA HERA particle dosimeters "
                    "for DONKI solar energetic particle (SEP) events."
                ),
                "sourceLabel": "NASA Orion Radiation Protection Plan",
                "sourceUrl": "https://www.nasa.gov/missions/artemis/orion/scientists-and-engineers-evaluate-orion-radiation-protection-plan/",
            },
        ],
        "rockets": [
            {
                "id": "light",
                "name": "Light (Single-Core Medium-Heavy Class)",
                "realAnalog": "Vulcan VC0 / Falcon 9 Expendable Class",
                "payloadToMoonKg": 9000,
                "payloadToMoonNote": (
                    "Game-balanced single-core TLI limit (~9 t; real Falcon 9 expendable is ~4–5.5 t TLI / "
                    "~8.3 t GTO and Vulcan VC0/VC2 spans ~4.8–9.5 t TLI). Cannot lift a full crewed Orion stack."
                ),
                "costMUsd": 150,
                "diameterM": 3.7,
                "boosters": None,
                "stage1": {
                    "dryKg": 25600,
                    "propKg": 411000,
                    "thrustVacN": 8227000,
                    "thrustSlN": 7607000,
                    "ispVac": 311,
                    "ispSl": 282,
                },
                "stage2": {
                    "dryKg": 4000,
                    "propKg": 107500,
                    "thrustVacN": 981000,
                    "thrustSlN": 280000,
                    "ispVac": 348,
                    "ispSl": 150,
                },
                "realReference": {
                    "falcon9Block5": {
                        "diameterM": 3.66,
                        "stage1Engines": "9x Merlin 1D (LOX/RP-1)",
                        "stage1ThrustSlN": 7607000,
                        "stage1IspSl": 282,
                        "stage1IspVac": 311,
                        "stage2Engine": "1x Merlin 1D Vacuum",
                        "stage2ThrustVacN": 981000,
                        "stage2IspVac": 348,
                        "stage2PropKg": 107500,
                    },
                    "vulcanVC0": {
                        "diameterM": 5.4,
                        "stage1Engines": "2x BE-4 (LOX/LNG)",
                        "stage1ThrustSlN": 4893000,
                        "stage2Engine": "2x RL10C (Centaur V-L, 39 t LH2/LOX)",
                        "stage2ThrustVacN": 213000,
                        "stage2IspVac": 450,
                    },
                },
                "notes": "Single-stick kerolox/methalox reference for FlightSim; too small for crewed Orion to the Moon.",
                "sourceLabel": "SpaceX Falcon 9 / ULA Vulcan Centaur Reference",
                "sourceUrl": "https://www.spacex.com/vehicles/falcon-9/",
            },
            {
                "id": "medium",
                "name": "Medium (3-Core Heavy Class)",
                "realAnalog": "SpaceX Falcon Heavy (Expendable) Class",
                "payloadToMoonKg": 20000,
                "payloadToMoonNote": (
                    "NASA LSP cites 15,310 kg at C3 = -1 km2/s2 for Falcon Heavy Expendable; game-balanced "
                    "to 20,000 kg so players can fly the light flyby stack (19,940 kg) while full lunar "
                    "orbit stack (25,040–26,490 kg) requires Heavy (SLS Block 1)."
                ),
                "costMUsd": 180,
                "diameterM": 4.4,
                "boosters": {
                    "dryKg": 51200,
                    "propKg": 822000,
                    "thrustVacN": 16454000,
                    "thrustSlN": 15214000,
                    "ispVac": 311,
                    "ispSl": 282,
                },
                "stage1": {
                    "dryKg": 28000,
                    "propKg": 411000,
                    "thrustVacN": 8227000,
                    "thrustSlN": 7607000,
                    "ispVac": 311,
                    "ispSl": 282,
                },
                "stage2": {
                    "dryKg": 4000,
                    "propKg": 107500,
                    "thrustVacN": 981000,
                    "thrustSlN": 280000,
                    "ispVac": 348,
                    "ispSl": 150,
                },
                "realReference": {
                    "falconHeavy": {
                        "boosters": "2x Falcon 9 Side Cores (18x Merlin 1D)",
                        "centerCore": "1x Falcon 9 Core (9x Merlin 1D)",
                        "upperStage": "1x Merlin 1D Vacuum (981 kN, 348 s vac, ~107.5 t prop)",
                        "nasaLspLunarC3Minus1Kg": 15310,
                        "gtoExpendableKg": 26700,
                    }
                },
                "notes": "Triple-core booster layout matching Rocket.tsx Medium stack (2 side boosters + center core).",
                "sourceLabel": "SpaceX Falcon Heavy & NASA LSP Performance Portal",
                "sourceUrl": "https://www.spacex.com/vehicles/falcon-heavy/",
            },
            {
                "id": "heavy",
                "name": "Heavy (NASA SLS Block 1)",
                "realAnalog": "NASA Space Launch System Block 1",
                "payloadToMoonKg": 27000,
                "payloadToMoonNote": "NASA SLS Block 1 official capability: >27 metric tons (27,000+ kg) to TLI.",
                "costMUsd": 1200,
                "diameterM": 8.4,
                "boosters": {
                    "dryKg": 198000,
                    "propKg": 1263000,
                    "thrustVacN": 32000000,
                    "thrustSlN": 28800000,
                    "ispVac": 268,
                    "ispSl": 237,
                },
                "stage1": {
                    "dryKg": 100062,
                    "propKg": 980000,
                    "thrustVacN": 9116000,
                    "thrustSlN": 7440000,
                    "ispVac": 452.3,
                    "ispSl": 366,
                },
                "stage2": {
                    "dryKg": 3765,
                    "propKg": 26853,
                    "thrustVacN": 110100,
                    "thrustSlN": 30000,
                    "ispVac": 462,
                    "ispSl": 200,
                },
                "realReference": {
                    "slsBlock1": {
                        "boosters": "2x 5-Segment PBAN SRBs (~16 MN each, ~631,495 kg prop each, ~268 s vac)",
                        "coreStageDiameterM": 8.4,
                        "coreStageDryKg": 100062,
                        "coreStagePropKg": 980000,
                        "coreStageEngines": "4x RS-25 at 109% RPL (1,860 kN SL / 2,279 kN vac each; 366 s SL / 452.3 s vac)",
                        "icpsDiameterM": 5.0,
                        "icpsDryKg": 3765,
                        "icpsPropKg": 26853,
                        "icpsEngine": "1x RL10B-2 (110.1 kN vac, ~462 s vac)",
                        "tliCapacityKg": 27000,
                    }
                },
                "notes": (
                    "Exact NASA SLS Block 1 SRB, RS-25 Core Stage, and ICPS RL10B-2 parameters. Note: "
                    "FlightSim currently scales stage masses down for fast ascent, so tune FlightSim TLI "
                    "cutoff if substituting full 2.5M kg real SLS liftoff mass."
                ),
                "sourceLabel": "NASA Space Launch System (SLS) & Core Stage Fact Sheets",
                "sourceUrl": "https://www.nasa.gov/humans-in-space/space-launch-system/",
            },
        ],
        "vehicleData": {
            "escapeTowerKg": 7711,
            "escapeTowerRealLasKg": 7711,
            "serviceEngine": {
                "name": "Aerojet Rocketdyne AJ10-190 (Orion ESM OME)",
                "thrustN": 26700,
                "isp": 316,
                "dryKg": 118,
                "sourceUrl": "https://www.esa.int/Science_Exploration/Human_and_Robotic_Exploration/Orion/European_Service_Module",
            },
            "servicePropellantKg": {
                "serviceSmall": 3500,
                "serviceLarge": 9000,
            },
            "capsule": {
                "diameter": 5.0,
                "dragCoefficient": 1.3,
                "parachuteCdA": 1500,
                "sourceUrl": "https://www.nasa.gov/humans-in-space/orion-spacecraft/",
            },
        },
    }


def build_explanations_payload() -> dict[str, Any]:
    # One entry per thing the mission report can blame (see FindingArea in
    # src/core/missionReport.ts); the report shows the matching ones.
    explanations = [
        {
            "id": "launch_envelope",
            "term": "Rocket Payload to the Moon",
            "shortExplanation": (
                "A rocket can push far less mass to the Moon than to low Earth orbit: the trans-lunar "
                "injection burn needs about 3.1 km/s more after orbit. SLS Block 1 sends over 27 t to "
                "the Moon, a Falcon 9-class rocket only a few tonnes."
            ),
            "tradeOffTip": (
                "Every part you add has to fit under the rocket's Moon payload. If the stack is too "
                "heavy, drop a part you do not need or pay for a bigger rocket."
            ),
            "formula": "Fits = m_spacecraft <= payload_TLI(rocket)",
            "sourceLabel": "NASA — Space Launch System Core Stage",
            "sourceUrl": "https://www.nasa.gov/reference/space-launch-system-core-stage/",
        },
        {
            "id": "staging",
            "term": "Staging",
            "shortExplanation": (
                "A rocket throws away empty tanks and engines as it climbs, so the next stage only "
                "pushes what is still useful. That is why every real Moon rocket has two or more stages "
                "plus boosters."
            ),
            "tradeOffTip": (
                "If a stage runs dry before orbit, the vehicle is too heavy for that rocket: lighten "
                "the spacecraft or pick the bigger rocket."
            ),
            "formula": "dv_total = sum over stages of Isp_i * g0 * ln(m0_i / mf_i)",
            "sourceLabel": "NASA Glenn Research Center — Booster Staging",
            "sourceUrl": "https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/stage/",
        },
        {
            "id": "rocket_equation",
            "term": "Delta-v and the Rocket Equation",
            "shortExplanation": (
                "Delta-v is how much a spacecraft can change its speed with the propellant it carries. "
                "It grows only with the logarithm of the mass ratio, so extra fuel buys less and less."
            ),
            "tradeOffTip": (
                "Course corrections and the trip home come out of the service module's delta-v. A "
                "larger service module gives margin, but it is heavier for the rocket."
            ),
            "formula": "dv = Isp * g0 * ln(m_full / m_empty)",
            "sourceLabel": "NASA Glenn Research Center — Ideal Rocket Equation",
            "sourceUrl": "https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/ideal-rocket-equation/",
        },
        {
            "id": "free_return",
            "term": "Trans-Lunar Injection and Free Return",
            "shortExplanation": (
                "From the parking orbit, one burn (trans-lunar injection) raises the far point of the "
                "orbit to the Moon's distance. Timed right, the Moon's gravity swings the spacecraft "
                "round its far side and back to Earth without another big burn, as on Artemis II."
            ),
            "tradeOffTip": (
                "Burn too early or too late and the Moon is not there when you arrive. Fire when the "
                "Moon is the right angle ahead, and keep propellant for the small corrections."
            ),
            "formula": "v_TLI = sqrt(mu * (2/r - 1/a)), a = (r + d_Moon) / 2",
            "sourceLabel": "NASA — Artemis II Press Kit",
            "sourceUrl": "https://www.nasa.gov/artemis-ii-press-kit/",
        },
        {
            "id": "life_support",
            "term": "Life Support Consumables",
            "shortExplanation": (
                "The crew needs oxygen, water and carbon dioxide removal for every day of the flight. "
                "The life support system carries a fixed number of days; a slower trip uses them up."
            ),
            "tradeOffTip": (
                "Plan for the days the flight really takes, plus a margin for a late return, not just "
                "the nominal mission length."
            ),
            "formula": "Safe = days_on_board >= days_of_flight",
            "sourceLabel": "NASA — Environmental Control and Life Support Systems (ECLSS)",
            "sourceUrl": "https://www.nasa.gov/reference/environmental-control-and-life-support-systems-eclss/",
        },
        {
            "id": "reentry",
            "term": "Re-entry and the Heat Shield",
            "shortExplanation": (
                "Coming back from the Moon the capsule hits the air at about 11 km/s, much faster than "
                "from low orbit (about 7.8 km/s). The heat shield takes the heat and the angle of entry "
                "sets how hard the crew is pressed into their seats."
            ),
            "tradeOffTip": (
                "Too steep and the g-load and heating are dangerous; too shallow and the capsule skips "
                "off the atmosphere. Course corrections on the way home aim for the narrow corridor."
            ),
            "formula": "Energy per kg = v^2 / 2  (about 60 MJ/kg at 11 km/s)",
            "sourceLabel": "NASA — Orion Spacecraft",
            "sourceUrl": "https://www.nasa.gov/humans-in-space/orion-spacecraft/",
        },
        {
            "id": "space_weather",
            "term": "Solar Storms (NASA DONKI)",
            "shortExplanation": (
                "Solar flares and coronal mass ejections can send bursts of energetic protons. Near "
                "Earth the magnetic field deflects them; on the way to the Moon nothing does."
            ),
            "tradeOffTip": (
                "The events in the game are real ones from NASA's DONKI database. The dangerous ones "
                "are the proton events (NOAA S-scale), not only a high Kp."
            ),
            "formula": "S = floor(log10(proton flux in pfu)), from 10 pfu (S1)",
            "sourceLabel": "NASA CCMC DONKI Space Weather Database",
            "sourceUrl": "https://ccmc.gsfc.nasa.gov/tools/DONKI/",
        },
        {
            "id": "radiation_shelter",
            "term": "Radiation Storm Shelter",
            "shortExplanation": (
                "Orion has no heavy shielding everywhere, so during a solar particle event the crew "
                "builds a dense shelter with the stowage bags on board and waits inside."
            ),
            "tradeOffTip": (
                "Fit the radiation shelter for deep space flights. Without it, a strong storm outside "
                "the magnetosphere gives the crew a dangerous dose."
            ),
            "formula": "Safe = inside magnetosphere OR flux < 10 pfu OR shelter fitted",
            "sourceLabel": "NASA — Orion Radiation Protection Plan",
            "sourceUrl": "https://www.nasa.gov/missions/artemis/orion/scientists-and-engineers-evaluate-orion-radiation-protection-plan/",
        },
    ]

    video_storyboard_30s = [
        {
            "time": "0-3s",
            "visual": "Night side of 3D Earth globe with glowing NASA FIRMS wildfire clusters.",
            "caption": "Wildfires spread fast. Can you design the satellite that spots them in time?",
        },
        {
            "time": "3-8s",
            "visual": "Workshop: snapping solar wings, S-band dish, and thermal camera onto 3D satellite; 6 gauges react live.",
            "caption": "Every part trades mass, power, data, and budget.",
        },
        {
            "time": "8-13s",
            "visual": "Orbit view switching LEO -> SSO -> GEO with live ground track, shadow cone, and SCaN stations.",
            "caption": "Every orbit changes what you can see—and how long you survive.",
        },
        {
            "time": "13-15s",
            "visual": "Rocket check passes -> 3D liftoff sequence.",
            "caption": "Pick a rocket that can actually carry your design there.",
        },
        {
            "time": "15-20s",
            "visual": "Mission Control: S-band antenna falls behind, onboard memory hits 100%, red root-cause report.",
            "caption": "Mission failed: 32 GB/day generated, only 12 GB/day downlinked.",
        },
        {
            "time": "20-26s",
            "visual": "Click Redesign -> swap S-band for X-band -> fires detected worldwide -> 3-star Mission Report.",
            "caption": "Learn from root causes. Redesign. Fly again.",
        },
        {
            "time": "26-30s",
            "visual": "Mission Architect title card + public Firebase URL.",
            "caption": "Mission Architect — Team !subri — NASA Space Apps Challenge 2026.",
        },
    ]

    return {
        "dataset": "Mission Architect In-Game Educational Guide & 30s Demo Storyboard",
        "explanations": explanations,
        "videoStoryboard30s": video_storyboard_30s,
    }

# validation of reference designs against rockets, orbits, and scenarios
def validate_reference_designs(
    parts_payload: dict[str, Any],
    rockets_payload: dict[str, Any],
    earth_orbits: list[dict[str, Any]],
    scenarios_payload: dict[str, Any],
) -> None:
    parts_by_id = {p["id"]: p for p in parts_payload["parts"]}
    rockets_by_id = {r["id"]: r for r in rockets_payload["rockets"]}
    scenarios_by_id = {s["id"]: s for s in scenarios_payload["scenarios"]}
    orbits_by_id = {o["orbitId"]: o for o in earth_orbits}

    # Add lunar orbit altitudes from known moon_orbits.json defaults for reference check
    orbits_by_id["lunar_polar"] = {"altitudeKm": 100.0, "eclipseMinutes": 42.0}

    for ref in parts_payload["referenceDesigns"]:
        selected = [parts_by_id[pid] for pid in ref["partIds"]]
        mass_kg = sum(p["massKg"] for p in selected)
        power_w = sum(p["powerW"] for p in selected)
        sat_cost_m = sum(p["costM"] for p in selected)
        data_gen = sum(-p["dataRateGBPerDay"] for p in selected if p["dataRateGBPerDay"] < 0)
        downlink = sum(p["dataRateGBPerDay"] for p in selected if p["dataRateGBPerDay"] > 0)
        battery_wh = sum(p.get("batteryCapacityWh", 0) for p in selected)
        storage_gb = sum(p.get("storageCapacityGB", 0) for p in selected)

        rocket = rockets_by_id[ref["rocketId"]]
        orbit_id = ref["orbitId"]
        max_mass = rocket["maxPayloadKg"].get(orbit_id)
        assert max_mass is not None, f"{ref['id']}: rocket {ref['rocketId']} cannot reach {orbit_id}"
        assert mass_kg <= max_mass, f"{ref['id']}: mass {mass_kg} kg > rocket max {max_mass} kg"

        if rocket["id"] == "rideshare":
            rocket_cost = math.ceil(mass_kg / 100.0) * rocket["costPer100KgM"]
        else:
            rocket_cost = rocket["costM"]

        satellites = ref.get("satellites", 1)
        total_cost = (sat_cost_m + rocket_cost) * satellites
        scenario = scenarios_by_id[ref["scenarioId"]]
        budget_m = scenario["requirements"]["budgetM"]

        assert total_cost <= budget_m, f"{ref['id']}: cost ${total_cost}M > budget ${budget_m}M"
        assert power_w > 0, f"{ref['id']}: negative power balance {power_w} W"
        assert downlink >= data_gen, f"{ref['id']}: downlink {downlink} < data_gen {data_gen}"
        assert battery_wh >= 40 and storage_gb >= 32, f"{ref['id']}: missing battery or storage"

        alt_km = orbits_by_id[orbit_id]["altitudeKm"]
        max_res = scenario["requirements"]["maxGroundResolutionKm"]
        instruments = [p for p in selected if p["subsystem"] == "instrument"]
        best_res = min(alt_km * inst["angularResRad"] for inst in instruments)
        assert best_res <= max_res, f"{ref['id']}: ground res {best_res:.3f} km > {max_res} km"

        print(
            f"[validate] PASS {ref['id']}: mass={mass_kg}kg/{max_mass}kg, "
            f"power=+{power_w}W, data={data_gen}/{downlink}GB/d, "
            f"res={best_res:.3f}km<={max_res}km, cost=${total_cost}M<=${budget_m}M"
        )

# validation of crewed lunar Orion/ESM/SLS reference stack and vehicle parameters
def validate_crewed_lunar(crewed_payload: dict[str, Any]) -> None:
    parts = {p["id"]: p for p in crewed_payload["parts"]}
    rockets = {r["id"]: r for r in crewed_payload["rockets"]}
    req = crewed_payload["missionRequirements"]
    budget_m = req["budgetMUsd"]

    required_part_ids = (
        "capsule",
        "serviceSmall",
        "serviceLarge",
        "lifeSupport7",
        "lifeSupport14",
        "solarPanels",
        "radiationShield",
    )
    for pid in required_part_ids:
        assert pid in parts, f"crewed_lunar missing part {pid}"
        assert parts[pid]["massKg"] > 0, f"crewed_lunar {pid} mass must be positive"
        assert parts[pid]["sourceUrl"].startswith("https://"), f"crewed_lunar {pid} invalid sourceUrl"

    for rid in ("light", "medium", "heavy"):
        r = rockets[rid]
        assert r["diameterM"] > 0 and r["payloadToMoonKg"] > 0
        for st_key in ("stage1", "stage2"):
            st = r[st_key]
            assert st["dryKg"] > 0 and st["propKg"] > 0
            assert st["thrustVacN"] >= st["thrustSlN"] > 0
            assert st["ispVac"] >= st["ispSl"] > 0
        if rid == "light":
            assert r["boosters"] is None
        else:
            b = r["boosters"]
            assert b is not None and b["dryKg"] > 0 and b["propKg"] > 0
            assert b["thrustVacN"] >= b["thrustSlN"] > 0
            assert b["ispVac"] >= b["ispSl"] > 0

    def check_stack(label: str, part_ids: list[str], rocket_id: str, min_o2_days: int = 0) -> tuple[int, int, int, int]:
        selected = [parts[pid] for pid in part_ids]
        mass_kg = sum(p["massKg"] for p in selected)
        power_w = sum(p["powerW"] for p in selected)
        cost_m = sum(p["costMUsd"] for p in selected) + rockets[rocket_id]["costMUsd"]
        o2_days = sum(p["oxygenDays"] for p in selected)
        max_payload = rockets[rocket_id]["payloadToMoonKg"]
        assert mass_kg <= max_payload, f"{label}: mass {mass_kg} kg > {rocket_id} limit {max_payload} kg"
        assert mass_kg > rockets["light"]["payloadToMoonKg"], f"{label}: should exceed light rocket limit"
        assert power_w > 0, f"{label}: non-positive power balance {power_w} W"
        assert cost_m <= budget_m, f"{label}: cost ${cost_m}M > budget ${budget_m}M"
        if min_o2_days:
            assert o2_days >= min_o2_days, f"{label}: O2 {o2_days}d < {min_o2_days}d"
        return mass_kg, max_payload, power_w, cost_m

    flyby_m, flyby_cap, flyby_p, flyby_c = check_stack(
        "crewed_flyby",
        ["capsule", "serviceSmall", "lifeSupport7", "solarPanels"],
        "medium",
        req["durationDays"],
    )
    min_orbit_m, heavy_cap, min_orbit_p, min_orbit_c = check_stack(
        "crewed_min_orbit",
        ["capsule", "serviceLarge", "lifeSupport7", "solarPanels"],
        "heavy",
        req["durationDays"],
    )
    assert min_orbit_m > rockets["medium"]["payloadToMoonKg"], (
        "crewed_min_orbit must require heavy (SLS Block 1) rather than medium"
    )
    full_m, _, full_p, full_c = check_stack(
        "crewed_full_artemis",
        ["capsule", "serviceLarge", "lifeSupport14", "solarPanels", "radiationShield"],
        "heavy",
        req["durationDays"],
    )

    vd = crewed_payload["vehicleData"]
    assert vd["escapeTowerKg"] > 0
    assert vd["serviceEngine"]["thrustN"] > 0 and vd["serviceEngine"]["isp"] > 0
    assert vd["servicePropellantKg"]["serviceSmall"] == parts["serviceSmall"]["propellantKg"]
    assert vd["servicePropellantKg"]["serviceLarge"] == parts["serviceLarge"]["propellantKg"]
    assert vd["capsule"]["diameter"] > 0 and vd["capsule"]["parachuteCdA"] > 0

    print(
        f"[validate] PASS crewed_flyby (medium): mass={flyby_m}kg/{flyby_cap}kg, "
        f"power=+{flyby_p}W, cost=${flyby_c}M<=${budget_m}M"
    )
    print(
        f"[validate] PASS crewed_min_orbit (heavy): mass={min_orbit_m}kg/{heavy_cap}kg, "
        f"power=+{min_orbit_p}W, cost=${min_orbit_c}M<=${budget_m}M"
    )
    print(
        f"[validate] PASS crewed_full_artemis (heavy): mass={full_m}kg/{heavy_cap}kg, "
        f"power=+{full_p}W, cost=${full_c}M<=${budget_m}M"
    )

# auxiliary function to write JSON payloads to disk
def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

# main entry point to build all data payloads and write them to the public/data directory
def main() -> None:
    root = Path(__file__).resolve().parent.parent
    data_dir = root / "public" / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    fires_payload = build_fires_payload(live=False)
    storms_payload = build_storms_payload(live=False)
    parts_payload = build_parts_payload()
    rockets_payload = build_rockets_payload()
    stations_payload = build_stations_payload()
    earth_body_payload = build_earth_body_payload(stations_payload)
    earth_orbits_payload = build_earth_orbits_payload()
    scenarios_payload = build_scenarios_payload()
    crewed_lunar_payload = build_crewed_lunar_payload()
    explanations_payload = build_explanations_payload()

    validate_reference_designs(
        parts_payload, rockets_payload, earth_orbits_payload, scenarios_payload
    )
    validate_crewed_lunar(crewed_lunar_payload)

    outputs = {
        "fires.json": fires_payload,
        "storms.json": storms_payload,
        "parts.json": parts_payload,
        "rockets.json": rockets_payload,
        "stations.json": stations_payload,
        "earth_body.json": earth_body_payload,
        "earth_orbits.json": earth_orbits_payload,
        "scenarios.json": scenarios_payload,
        "crewed_lunar.json": crewed_lunar_payload,
        "explanations.json": explanations_payload,
    }

    for filename, payload in outputs.items():
        target = data_dir / filename
        write_json(target, payload)
        print(f"[build_all_data] Generated {target}")


if __name__ == "__main__":
    main()