// NASA's published Artemis II trajectory (public/data/artemis2_trajectory.json,
// built by data-prep/build_artemis2.py from the Orion ephemeris NASA released)
// put into the game's world so the player can fly against the real mission.
//
// The file stores Orion's path in the Earth-Moon rotating frame: x towards the
// Moon, z along the normal of the Moon's orbit. Here it is turned back with the
// game's own Moon (src/core/orbit.ts), on the same mission clock as the player:
// Artemis II at T+3 days is drawn where it was relative to the Earth and the
// Moon 3 days after its liftoff. Distances are scaled by the game's Moon
// distance over the real one on that day (~5% at most), so the path goes round
// the game's Moon the way the real one went round the real Moon. The numbers
// shown to the player (closest approach, farthest point, entry) are the real,
// unscaled ones.

import raw from "../../public/data/artemis2_trajectory.json";
import { MOON_DISTANCE, R_EARTH, moonAngle, type Vec3 } from "./orbit";

interface ArtemisFile {
  sourceLabel: string;
  sourceUrl: string;
  launchUtc: string;
  summary: {
    firstPointMissionTimeS: number;
    closestMoonAltitudeKm: number;
    closestMoonMissionTimeS: number;
    maxEarthAltitudeKm: number;
    maxEarthDistanceMissionTimeS: number;
    entryInterfaceMissionTimeS: number;
    entrySpeedKmS: number;
  };
  /** [missionTimeS, xKm, yKm, zKm, moonDistanceKm] in the Earth-Moon rotating frame. */
  points: number[][];
}

const DATA = raw as ArtemisFile;
const PTS = DATA.points;

export const ARTEMIS2 = {
  sourceLabel: DATA.sourceLabel,
  sourceUrl: DATA.sourceUrl,
  launchUtc: DATA.launchUtc,
  ...DATA.summary,
  startS: PTS[0][0],
  endS: PTS[PTS.length - 1][0],
};

/** Index of the last point at or before mission time `s` (binary search). */
function indexAt(s: number) {
  let lo = 0;
  let hi = PTS.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (PTS[mid][0] <= s) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Artemis II in the rotating frame at mission time `s` (linear between points), or null outside the data. */
function rotatingAt(s: number): number[] | null {
  if (s < ARTEMIS2.startS || s > ARTEMIS2.endS) return null;
  const i = indexAt(s);
  const a = PTS[i];
  const b = PTS[Math.min(i + 1, PTS.length - 1)];
  const f = b[0] > a[0] ? (s - a[0]) / (b[0] - a[0]) : 0;
  return a.map((v, k) => v + (b[k] - v) * f);
}

/** Real altitude of Artemis II above the Earth at mission time `s` (m), or null. */
export function artemisAltitudeAt(missionTimeS: number): number | null {
  const p = rotatingAt(missionTimeS);
  if (!p) return null;
  return Math.hypot(p[1], p[2], p[3]) * 1000 - R_EARTH;
}

/** Turns a rotating-frame point into the game's inertial frame at simulation time `t`. */
function toGame(p: number[], t: number): Vec3 {
  // The game's Moon goes round clockwise seen from +Z (prograde with the Earth's
  // spin), so the frame's y axis (the Moon's direction of motion) is (sin a, -cos a)
  // and its orbit normal is -Z.
  const a = moonAngle(t);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const k = (MOON_DISTANCE / (p[4] * 1000)) * 1000;
  return { x: (p[1] * c + p[2] * s) * k, y: (p[1] * s - p[2] * c) * k, z: -p[3] * k };
}

/**
 * The whole Artemis II path in the game's inertial frame (m), with simulation
 * time = `liftoffT` + Artemis II mission time.
 */
export function artemisPath(liftoffT: number): Vec3[] {
  return PTS.map((p) => toGame(p, liftoffT + p[0]));
}
