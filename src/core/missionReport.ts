// The mission report: once the flight is over, what happened, what went wrong
// and why, so the player can go back and redesign. Pure logic over the finished
// FlightSim; the interface only has to show it.
//
// Every finding has a cause the player can act on (a part, the rocket or the
// plan) and the numbers behind it. When several things went wrong, the root
// cause comes first: the one that, fixed, would have saved the mission.
//
// For the interface: when the telemetry says done or failed, call
//   missionReport(simRef.current, parts, rocket, stormResult)
// and show `headline`, then `findings` (each with severity, title, detail and
// fix) and the numbers in `stats`.

import { MISSION_REQUIREMENTS, PARTS_BY_ID, totals, type PartId } from "./design";
import { ROCKETS_BY_ID, launchCheck, type RocketId } from "./launchCheck";
import { R_EARTH, R_MOON, type Vec3 } from "./orbit";
import { freeReturn, type FlightSim } from "./simulate";
import type { StormResult } from "./spaceWeather";

export type Severity = "ok" | "warn" | "bad";

/** What part of the design a finding is about. */
export type FindingArea = "launch" | "trajectory" | "propulsion" | "life-support" | "reentry" | "radiation" | "budget";

export interface Finding {
  severity: Severity;
  area: FindingArea;
  title: string;
  /** What happened, with the numbers. */
  detail: string;
  /** What to change next time. Empty when nothing needs changing. */
  fix: string;
}

export type MissionVerdict = "success" | "partial" | "failure";

export interface MissionStats {
  /** Days from liftoff to splashdown, or to when the flight was lost. */
  missionDays: number;
  /** Closest pass above the Moon's surface (km), NaN if it never left Earth orbit. */
  closestMoonKm: number;
  /** Farthest distance from the Earth's surface (km). */
  maxAltitudeKm: number;
  /** Highest load on the crew in the whole flight and during re-entry (g). */
  maxG: number;
  entryMaxG: number;
  /** Delta-v spent on course corrections and still unused in the service module (m/s), at its separation if it was dropped. */
  correctionDv: number;
  serviceDvLeft: number;
  /** Life support on board and left at the end (days). */
  lifeSupportDays: number;
  lifeSupportLeftDays: number;
  /** Design plus rocket, and the mission budget (million USD). */
  costMUsd: number;
  budgetMUsd: number;
}

export interface MissionReport {
  verdict: MissionVerdict;
  /** One line for the top of the report. */
  headline: string;
  /** The finding that decided the outcome, also first in `findings`. Null on a clean success. */
  rootCause: Finding | null;
  /** Everything worth telling, worst first. */
  findings: Finding[];
  stats: MissionStats;
}

/* ---------------------------------------------------------- thresholds */

/** A spacecraft that never got closer than this did not really go round the Moon. */
const FLYBY_MAX_KM = 60000;
/** Re-entry load: Orion's skip entry peaks near 4 g, Apollo's direct entry near 6.5 g. */
const ENTRY_G_HARD = 6;
const ENTRY_G_DANGEROUS = 9;
/** Landing with less life support left than this is cutting it close. */
const LIFE_SUPPORT_TIGHT_DAYS = 0.5;
/** Entry corridor for the vacuum perigee of the way home (m). */
const CORRIDOR_MIN = -0.6 * R_EARTH;
const CORRIDOR_MAX = 120000;

const SEVERITY_RANK: Record<Severity, number> = { bad: 0, warn: 1, ok: 2 };

const days1 = (d: number) => `${d.toFixed(1)} days`;
const hours = (d: number) => `${Math.round(d * 24)} h`;
const km = (k: number) => `${Math.round(k).toLocaleString("en-US")} km`;

/* -------------------------------------------------------------- report */

/**
 * Builds the report for a finished flight. `storm` is the solar storm result
 * shown during the flight, if one arrived before the end.
 */
export function missionReport(
  sim: FlightSim,
  parts: PartId[],
  rocket: RocketId,
  storm: StormResult | null = null,
): MissionReport {
  const stats = statsOf(sim, parts, rocket);
  const findings: Finding[] = [];
  let rootCause: Finding | null = null;

  if (sim.phase === "failed") {
    rootCause = failureCause(sim, parts, rocket, stats);
    findings.push(rootCause);
  } else if (sim.phase !== "splashdown") {
    rootCause = {
      severity: "warn",
      area: "trajectory",
      title: "The flight isn't over yet",
      detail: `Day ${stats.missionDays.toFixed(1)}, phase "${sim.phase}".`,
      fix: "",
    };
    findings.push(rootCause);
  }

  findings.push(...conditionFindings(sim, parts, stats, storm, rootCause));

  // Worst first, keeping the root cause on top.
  const rest = findings.filter((f) => f !== rootCause).sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  const ordered = rootCause ? [rootCause, ...rest] : rest;

  let verdict: MissionVerdict;
  if (sim.phase === "failed" || sim.phase !== "splashdown") verdict = "failure";
  else if (ordered.some((f) => f.severity === "bad")) verdict = "partial";
  else verdict = "success";

  // On a splashdown with problems, the worst one is what to fix first.
  if (verdict === "partial") rootCause = ordered.find((f) => f.severity === "bad") ?? null;

  return { verdict, headline: headlineOf(verdict, sim, stats, rootCause), rootCause, findings: ordered, stats };
}

function statsOf(sim: FlightSim, parts: PartId[], rocket: RocketId): MissionStats {
  const left = sim.lifeSupportLeftDays;
  return {
    missionDays: sim.missionDays,
    closestMoonKm: isFinite(sim.closestMoon) ? (sim.closestMoon - R_MOON) / 1000 : NaN,
    maxAltitudeKm: sim.maxAltitude / 1000,
    maxG: sim.maxG,
    entryMaxG: sim.entryMaxG,
    correctionDv: sim.tcmUsed,
    serviceDvLeft: isFinite(sim.serviceDvAtSeparation) ? sim.serviceDvAtSeparation : sim.serviceDvLeft,
    lifeSupportDays: sim.lifeSupportDays,
    lifeSupportLeftDays: Math.max(0, left),
    costMUsd: totals(parts).costMUsd + ROCKETS_BY_ID[rocket].costMUsd,
    budgetMUsd: MISSION_REQUIREMENTS.budgetMUsd,
  };
}

/** Did it go round the Moon? */
const reachedMoon = (s: MissionStats) => isFinite(s.closestMoonKm) && s.closestMoonKm < FLYBY_MAX_KM;

/** Why a lost flight was lost: the cause the player can fix. */
function failureCause(sim: FlightSim, parts: PartId[], rocket: RocketId, s: MissionStats): Finding {
  const f = sim.failure;
  const r = ROCKETS_BY_ID[rocket];

  if (f?.code === "ascent-propellant") {
    const lc = launchCheck(totals(parts).massKg, rocket);
    return {
      severity: "bad",
      area: "launch",
      title: "The rocket couldn't reach orbit",
      detail: `The ${r.name} rocket ran out of propellant before orbital speed. The spacecraft weighs ${km(totals(parts).massKg / 1000).replace(" km", " t")} and uses ${Math.round(lc.usage * 100)}% of what the rocket can send to the Moon.`,
      fix: "Choose a bigger rocket or take parts off the spacecraft.",
    };
  }

  if (f?.code === "life-support") {
    // Was it on its way home, just too slowly, or not coming home at all?
    const home = freeReturn({ t: sim.t, r: sim.r, v: sim.v }, { x: 0, y: 0, z: 0 } as Vec3, true);
    const inCorridor = home.pe >= CORRIDOR_MIN && home.pe <= CORRIDOR_MAX;
    if (reachedMoon(s) && inCorridor && isFinite(home.t)) {
      const short = (home.t - sim.t) / 86400;
      return {
        severity: "bad",
        area: "life-support",
        title: "Life support ran out before splashdown",
        detail: `The crew had oxygen, water and CO2 scrubbing for ${days1(s.lifeSupportDays)}, but the trip needed about ${days1(s.missionDays + short)}: ${hours(short)} short, with the spacecraft already on its way home.`,
        fix: parts.includes("lifeSupport14")
          ? "Plan a faster trip: a slightly bigger burn or a closer pass by the Moon shortens the way home."
          : "Fit the 14-day life support, or plan a faster trip in the orbit planner.",
      };
    }
    return {
      severity: "bad",
      area: "trajectory",
      title: reachedMoon(s) ? "The way home missed the Earth" : "The spacecraft never reached the Moon",
      detail: reachedMoon(s)
        ? `After passing ${km(s.closestMoonKm)} from the Moon the spacecraft was not heading into the entry corridor${s.serviceDvLeft < 1 ? ", and the service module had no propellant left to correct it" : ""}. Life support ran out on day ${s.missionDays.toFixed(1)}.`
        : `The closest it got to the Moon was ${isFinite(s.closestMoonKm) ? km(s.closestMoonKm) : "never left Earth orbit"}, so there was no swing round it to bring the crew back. Life support ran out on day ${s.missionDays.toFixed(1)}.`,
      fix:
        s.serviceDvLeft < 1 && reachedMoon(s)
          ? "Use the large service module for more correction propellant, and check the 'comes home' line in the orbit planner."
          : "In the orbit planner, change the burn point until all three checks are green.",
    };
  }

  if (f?.code === "ground-impact") {
    if (f.phase === "ascent" || f.phase === "prelaunch" || !isFinite(sim.entryT)) {
      return {
        severity: "bad",
        area: "launch",
        title: "Lost during the climb",
        detail: `The vehicle hit the ground at ${Math.round(f.speed ?? 0)} m/s on day ${s.missionDays.toFixed(2)}, before reaching orbit.`,
        fix: "Choose a rocket with more thrust for this spacecraft.",
      };
    }
    const steep = s.entryMaxG >= ENTRY_G_DANGEROUS;
    const noProp = s.serviceDvLeft < 1 && s.correctionDv > 0;
    return {
      severity: "bad",
      area: noProp ? "propulsion" : "reentry",
      title: steep ? "Re-entry too steep" : "Re-entry failed",
      detail: `The capsule came in at up to ${s.entryMaxG.toFixed(1)} g and hit the ground at ${Math.round(f.speed ?? 0)} m/s before the parachutes could open.${noProp ? " The service module ran out of propellant for the last course correction, so the entry angle could not be trimmed." : ""}`,
      fix: noProp
        ? "Use the large service module, or a plan that needs smaller corrections (green 'comes home' check)."
        : "Plan a return that lands in the entry corridor: the 'comes home' check in the orbit planner should be green.",
    };
  }

  return {
    severity: "bad",
    area: "trajectory",
    title: "Vehicle lost",
    detail: sim.message || `The flight ended on day ${s.missionDays.toFixed(1)}.`,
    fix: "",
  };
}

/** Everything else worth telling, whatever the outcome. */
function conditionFindings(
  sim: FlightSim,
  parts: PartId[],
  s: MissionStats,
  storm: StormResult | null,
  rootCause: Finding | null,
): Finding[] {
  const out: Finding[] = [];
  const home = sim.phase === "splashdown";
  const area = (a: FindingArea) => rootCause?.area === a;

  // Moon
  if (home) {
    if (reachedMoon(s)) {
      out.push({
        severity: "ok",
        area: "trajectory",
        title: "Swung round the Moon",
        detail: `Closest pass ${km(s.closestMoonKm)} above the surface, farthest ${km(s.maxAltitudeKm)} from the Earth.`,
        fix: "",
      });
    } else {
      out.push({
        severity: "bad",
        area: "trajectory",
        title: "Came home without reaching the Moon",
        detail: `The closest pass was ${isFinite(s.closestMoonKm) ? km(s.closestMoonKm) : "never left Earth orbit"}: the mission goal was not met.`,
        fix: "In the orbit planner, adjust the burn point until the Moon check is green.",
      });
    }
  }

  // Life support margin
  if (home && !area("life-support")) {
    const left = s.lifeSupportLeftDays;
    out.push(
      left < LIFE_SUPPORT_TIGHT_DAYS
        ? {
            severity: "warn",
            area: "life-support",
            title: "Home with almost no life support left",
            detail: `Only ${hours(left)} of oxygen and CO2 scrubbing were left at splashdown (${days1(s.lifeSupportDays)} on board, trip ${days1(s.missionDays)}).`,
            fix: parts.includes("lifeSupport14") ? "Plan a faster trip to keep a margin." : "Fit the 14-day life support for a margin.",
          }
        : {
            severity: "ok",
            area: "life-support",
            title: "Life support lasted",
            detail: `${days1(left)} to spare: ${days1(s.lifeSupportDays)} on board for a ${days1(s.missionDays)} trip.`,
            fix: "",
          },
    );
  }

  // Re-entry load
  if (home && isFinite(sim.entryT)) {
    const g = s.entryMaxG;
    out.push(
      g >= ENTRY_G_DANGEROUS
        ? {
            severity: "bad",
            area: "reentry",
            title: "Dangerous re-entry",
            detail: `The crew took ${g.toFixed(1)} g on the way down (Orion is designed for about 4 g, Apollo peaked near 6.5 g). The return came in too steep.`,
            fix: "Pick a plan whose way home lands in the entry corridor without big late corrections.",
          }
        : g >= ENTRY_G_HARD
          ? {
              severity: "warn",
              area: "reentry",
              title: "Hard re-entry",
              detail: `Peak load ${g.toFixed(1)} g, survivable but well above Orion's ~4 g.`,
              fix: "A plan with a green 'comes home' check needs smaller corrections and gives a gentler entry.",
            }
          : {
              severity: "ok",
              area: "reentry",
              title: "Safe re-entry",
              detail: `Peak load ${g.toFixed(1)} g.`,
              fix: "",
            },
    );
  }

  // Propellant
  if (s.correctionDv > 0 || home) {
    const tight = s.serviceDvLeft < 30 && sim.phase !== "failed";
    if (!area("propulsion")) {
      out.push({
        severity: tight ? "warn" : "ok",
        area: "propulsion",
        title: tight ? "Course corrections used almost all the propellant" : "Propellant for corrections",
        detail: `Corrections used ${Math.round(s.correctionDv)} m/s; ${Math.round(s.serviceDvLeft)} m/s was left in the service module.`,
        fix: tight ? "Use the large service module, or a plan that needs smaller corrections." : "",
      });
    }
  }

  // Solar storm
  if (storm) {
    out.push({
      severity: storm.severity,
      area: "radiation",
      title: storm.headline,
      detail: storm.explanation,
      fix:
        storm.severity === "ok"
          ? ""
          : parts.includes("radiationShield")
            ? ""
            : `Fit the ${PARTS_BY_ID.radiationShield.name.toLowerCase()} so the crew has somewhere to shelter.`,
    });
  }

  // Budget
  if (s.costMUsd > s.budgetMUsd) {
    out.push({
      severity: "bad",
      area: "budget",
      title: "Over budget",
      detail: `$${s.costMUsd.toLocaleString("en-US")}M against a budget of $${s.budgetMUsd.toLocaleString("en-US")}M.`,
      fix: "Choose a cheaper rocket or fewer parts.",
    });
  }

  return out;
}

/** "Re-entry too steep" -> "re-entry too steep", keeping names like "Earth". */
const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

function headlineOf(verdict: MissionVerdict, sim: FlightSim, s: MissionStats, root: Finding | null): string {
  if (verdict === "success") return `Mission success: the crew is home after ${days1(s.missionDays)}.`;
  if (verdict === "partial") return `The crew is home after ${days1(s.missionDays)}, but: ${root ? lowerFirst(root.title) : "there were problems"}.`;
  if (sim.phase !== "failed") return root?.title ?? "The flight isn't over yet.";
  if (!isFinite(sim.liftoffT) || root?.area === "launch") return `Mission lost during launch: ${root ? lowerFirst(root.title) : "vehicle lost"}.`;
  return `Mission lost on day ${s.missionDays.toFixed(1)}: ${root ? lowerFirst(root.title) : "vehicle lost"}.`;
}

