// Real solar storms from NASA's DONKI space weather database
// (public/data/storms.json, archived by data-prep/fetch_donki.py) replayed
// during the flight. The physics here is deliberately simple and kept apart
// from the flight simulation: the storm only decides what happens to the crew.
//
// What is real: each storm's DONKI activity ID, date, Kp index and the peak
// >=10 MeV proton flux measured by GOES (NOAA SWPC proton event list).
// What is a game choice: the storm reaches the spacecraft STORM_ONSET_S after
// liftoff, and the magnetosphere is treated as a sphere of MAGNETOPAUSE_ALT_M.

import raw from "../../public/data/storms.json";
import type { SolarStormSpec } from "../types/mission";
import type { PartId } from "./design";

export const STORMS: SolarStormSpec[] = raw.storms as SolarStormSpec[];
export const STORMS_BY_ID: Record<string, SolarStormSpec> = Object.fromEntries(STORMS.map((s) => [s.id, s]));

/** The storm the game picks first: the strongest proton event in the archive. */
export const DEFAULT_STORM_ID: string = [...STORMS].sort((a, b) => b.protonFluxPfu - a.protonFluxPfu)[0]?.id ?? "";

/** Mission time (after liftoff) when the storm reaches the spacecraft. Game choice: on the way to the Moon. */
export const STORM_ONSET_S = 2 * 86400;

/**
 * Altitude above which the Earth's magnetic field no longer deflects solar protons.
 * The dayside magnetopause sits at about 10 Earth radii (~64,000 km from the centre).
 */
export const MAGNETOPAUSE_ALT_M = 57_000_000;

/** NOAA solar radiation storm scale: S1 at 10 pfu, then x10 per level (>=10 MeV protons). */
export function radiationScale(pfu: number): number {
  if (pfu < 10) return 0;
  return Math.min(5, Math.floor(Math.log10(pfu)));
}

/** Proton flux from S2 (100 pfu) up is treated as dangerous for an unsheltered crew outside the magnetosphere. */
const DANGEROUS_PFU = 100;

export type StormOutcome = "inside-magnetosphere" | "no-protons" | "sheltered" | "minor-dose" | "exposed";

export interface StormResult {
  storm: SolarStormSpec;
  outcome: StormOutcome;
  severity: "ok" | "warn" | "bad";
  headline: string;
  explanation: string;
}

function dateLabel(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** Short label for menus. */
export function stormLabel(s: SolarStormSpec) {
  const scale = radiationScale(s.protonFluxPfu);
  return `${dateLabel(s.startTimeUtc)}: Kp ${s.kpIndex}, ${scale > 0 ? `S${scale} radiation` : "no proton event"}`;
}

/** What the storm does to the crew, given where the spacecraft is when it arrives. */
export function stormOutcome(storm: SolarStormSpec, parts: PartId[], altitudeM: number): StormResult {
  const pfu = storm.protonFluxPfu;
  const scale = radiationScale(pfu);
  const facts = `NASA DONKI ${storm.donkiActivityId}, ${dateLabel(storm.startTimeUtc)}: Kp ${storm.kpIndex}, peak proton flux ${pfu} pfu${scale > 0 ? ` (NOAA S${scale})` : ""}.`;
  const base = { storm };

  if (altitudeM < MAGNETOPAUSE_ALT_M) {
    return {
      ...base,
      outcome: "inside-magnetosphere",
      severity: "ok",
      headline: "Solar storm: the Earth's magnetic field protects the crew",
      explanation: `${facts} The spacecraft is still inside the magnetosphere, which deflects most solar protons. In low orbit the storm heats the upper atmosphere and adds drag instead.`,
    };
  }
  if (scale === 0) {
    return {
      ...base,
      outcome: "no-protons",
      severity: "ok",
      headline: "Solar storm: geomagnetic only, no radiation for the crew",
      explanation: `${facts} A high Kp shakes the Earth's magnetic field, but this event sent almost no energetic protons, so the crew in deep space is not at risk.`,
    };
  }
  if (parts.includes("radiationShield")) {
    return {
      ...base,
      outcome: "sheltered",
      severity: "ok",
      headline: `Solar radiation storm: crew in the storm shelter for ${storm.safeModeHours} h`,
      explanation: `${facts} The crew moved into the shelter, surrounded by water and supplies that absorb protons, and the dose stayed low.`,
    };
  }
  if (pfu < DANGEROUS_PFU) {
    return {
      ...base,
      outcome: "minor-dose",
      severity: "warn",
      headline: "Solar radiation storm: the crew took an extra dose",
      explanation: `${facts} A minor event, but without a storm shelter the crew had nowhere to hide. Fit the radiation shelter for longer or stronger storms.`,
    };
  }
  return {
    ...base,
    outcome: "exposed",
    severity: "bad",
    headline: "Solar radiation storm: crew exposed, no shelter on board",
    explanation: `${facts} Outside the Earth's magnetic field there is nothing between the crew and the protons. Without a storm shelter the dose is dangerous. Go back to assembly and fit the radiation shelter.`,
  };
}
