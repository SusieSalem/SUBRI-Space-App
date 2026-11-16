// NASA LRO / LCROSS Lunar Polar Water-Ice Targets (Role 4 — Ice Hunter integration)
// Mirrors public/data/moon/moon_targets.json for instant synchronous access in the HUD and 3D flight scene.

export interface LunarIceTarget {
  id: string;
  name: string;
  pole: "south" | "north";
  lat: number;
  lon: number;
  diameterKm: number;
  floorTempK: number;
  iceConcentrationPct: number;
  scienceValue: number;
  notes: string;
}

export const LUNAR_ICE_TARGETS: LunarIceTarget[] = [
  {
    id: "psr_shackleton",
    name: "Shackleton Crater",
    pole: "south",
    lat: -89.9,
    lon: 0.0,
    diameterKm: 21.0,
    floorTempK: 40,
    iceConcentrationPct: 8.5,
    scienceValue: 100,
    notes: "Lunar South Pole cold trap; rim peaks receive near-continuous sunlight (Artemis III candidate).",
  },
  {
    id: "psr_cabeus",
    name: "Cabeus Crater (LCROSS)",
    pole: "south",
    lat: -84.9,
    lon: -35.5,
    diameterKm: 98.0,
    floorTempK: 38,
    iceConcentrationPct: 5.6,
    scienceValue: 95,
    notes: "NASA LCROSS impactor confirmed 5.6% water ice in the ejected plume (Oct 2009).",
  },
  {
    id: "psr_shoemaker",
    name: "Shoemaker Crater",
    pole: "south",
    lat: -88.1,
    lon: 44.9,
    diameterKm: 51.8,
    floorTempK: 35,
    iceConcentrationPct: 7.2,
    scienceValue: 90,
    notes: "Deep polar cold trap with strong hydrogen signature in LRO LEND neutron data.",
  },
  {
    id: "psr_haworth",
    name: "Haworth Crater",
    pole: "south",
    lat: -86.9,
    lon: -4.0,
    diameterKm: 51.4,
    floorTempK: 33,
    iceConcentrationPct: 6.8,
    scienceValue: 90,
    notes: "Coldest South Pole floor (~33 K measured by LRO Diviner).",
  },
  {
    id: "psr_faustini",
    name: "Faustini Crater",
    pole: "south",
    lat: -87.3,
    lon: 77.0,
    diameterKm: 42.5,
    floorTempK: 37,
    iceConcentrationPct: 6.4,
    scienceValue: 85,
    notes: "UV Lyman-alpha water frost signature detected by LRO LAMP.",
  },
  {
    id: "psr_de_gerlache",
    name: "de Gerlache Crater",
    pole: "south",
    lat: -88.5,
    lon: -87.1,
    diameterKm: 32.7,
    floorTempK: 39,
    iceConcentrationPct: 6.1,
    scienceValue: 85,
    notes: "Adjacent to Shackleton; rim ridge overlooks a vast permanently shadowed cold trap.",
  },
  {
    id: "psr_hermite_a",
    name: "Hermite Crater (26 K)",
    pole: "north",
    lat: 86.0,
    lon: -89.9,
    diameterKm: 104.0,
    floorTempK: 26,
    iceConcentrationPct: 7.8,
    scienceValue: 95,
    notes: "Coldest measured spot in the Solar System (26 K / -247 °C via LRO Diviner).",
  },
  {
    id: "psr_peary",
    name: "Peary Crater PSR",
    pole: "north",
    lat: 88.6,
    lon: 33.0,
    diameterKm: 73.0,
    floorTempK: 38,
    iceConcentrationPct: 6.5,
    scienceValue: 90,
    notes: "Closest major basin to the Lunar North Pole with permanently shadowed interior craters.",
  },
  {
    id: "psr_whipple",
    name: "Whipple Crater",
    pole: "north",
    lat: 89.1,
    lon: 119.9,
    diameterKm: 14.5,
    floorTempK: 36,
    iceConcentrationPct: 8.1,
    scienceValue: 90,
    notes: "High radar circular polarization ratio (NASA Mini-RF) indicating thick water-ice deposits.",
  },
];

/**
 * Returns how many lunar polar ice targets have been scanned based on the spacecraft's
 * closest approach to the Moon (meters). Within 60,000 km of the Moon, targets unlock progressively.
 */
export function getScannedLunarTargets(closestMoonM: number, currentMoonDistM: number): LunarIceTarget[] {
  const bestDist = Math.min(closestMoonM, currentMoonDistM);
  if (!Number.isFinite(bestDist) || bestDist > 60_000_000) return [];
  // Progress 0..1 as spacecraft approaches from 60,000 km down to perilune (~10,000 km)
  const progress = Math.max(0, Math.min(1, (60_000_000 - bestDist) / 48_000_000));
  const count = Math.max(1, Math.round(progress * LUNAR_ICE_TARGETS.length));
  return LUNAR_ICE_TARGETS.slice(0, count);
}
