// Orbit planner: the player's trans-lunar plan and its prediction.
//
// A plan is three numbers, like a maneuver node in an orbit game:
//   1. the height of the circular parking orbit,
//   2. where on that orbit to burn, given as the phase angle (how far ahead the Moon is),
//   3. how much delta-v the trans-lunar injection (TLI) burn adds, prograde.
//
// The prediction starts from the real parking orbit: the same autopilot ascent the
// flight uses is run headless for this rocket, design and height (and cached), so the
// burn point, the propellant left and the date match the flight. From there the burn
// is applied (impulsive) and the coast is propagated under Earth and Moon gravity.
// Plain TypeScript, no rendering, so it runs and is tested in Node.

import type { PartId } from "./design";
import type { RocketId } from "./launchCheck";
import {
  MOON_DISTANCE,
  MU_EARTH,
  R_EARTH,
  R_MOON,
  coastRk4,
  coastStep,
  findPhaseCrossing,
  moonAngle,
  moonPosition,
  orbitInfo,
  vadd,
  vdot,
  vlen,
  vnorm,
  vscale,
  type CoastState,
  type Vec3,
} from "./orbit";
import { FlightSim, PARKING_ALT, SERVICE_RESERVE_DV } from "./simulate";

export interface OrbitPlan {
  /** Target height of the circular parking orbit (m). */
  parkingAltM: number;
  /** Burn where the Moon is this many degrees ahead along the orbit (0..360). */
  phaseDeg: number;
  /** Prograde delta-v of the trans-lunar injection (m/s). */
  tliDvMs: number;
}

export const PARKING_ALT_RANGE = { min: 160000, max: 400000, step: 5000 };
export const TLI_DV_RANGE = { min: 2900, max: 3300 };

/** First plan shown: heads out towards the Moon but misses it, so the player has something to fix. */
export const DEFAULT_PLAN: OrbitPlan = { parkingAltM: PARKING_ALT, phaseDeg: 290, tliDvMs: 3130 };

/** Perilune band (height above the Moon) that gives a useful swing round it. */
const PERILUNE_MIN = 100000;
const PERILUNE_GOOD_MAX = 15000000;
const PERILUNE_WEAK_MAX = 60000000;
/**
 * Vacuum perigee of the way home. The return is very sensitive to the burn (a 1 m/s
 * change moves it by thousands of km), so real missions, and this autopilot, trim it
 * with small course corrections. Within this band they cost a few tens of m/s.
 */
const ENTRY_PERIGEE_MIN = 10000;
const ENTRY_PERIGEE_MAX = 120000;
const EASY_PERIGEE_MAX = 25000000;
const HARD_PERIGEE_MAX = 100000000;

export type Light = "ok" | "warn" | "bad";

export interface Check {
  state: Light;
  title: string;
  detail: string;
}

export interface ParkingOrbit {
  /** State in the parking orbit, as the flight reaches it. Null if the rocket can't get there. */
  state: CoastState | null;
  periapsisAlt: number;
  apoapsisAlt: number;
  period: number;
  stage2Dv: number;
  serviceDv: number;
  /** Delta-v usable for the TLI (service module reserve kept back). */
  available: number;
  failure: string | null;
}

/** A point of the predicted path, in the Earth-Moon frame (Moon fixed on +X), metres. */
export interface MapPoint {
  x: number;
  y: number;
  /** Hours after the burn. */
  h: number;
}

export interface PlanResult {
  parking: ParkingOrbit;
  /** Burn point and time (ECI). */
  burn: CoastState | null;
  /** Hours from reaching the parking orbit to the burn. */
  waitMin: number;
  apoapsisAlt: number;
  /** Closest approach to the Moon: height above its surface (m) and hours after the burn. */
  periluneAlt: number;
  periluneHours: number;
  hitsMoon: boolean;
  /** Vacuum perigee on the way home (m), NaN if it never comes back. */
  returnPerigeeAlt: number;
  returnHours: number;
  /** Path in the Earth-Moon frame: outbound up to the Moon, then home. */
  outbound: MapPoint[];
  inbound: MapPoint[];
  /** Burn and perilune points in the same frame. */
  burnPoint: MapPoint | null;
  perilunePoint: MapPoint | null;
  checks: { moon: Check; fuel: Check; home: Check };
  /** True when all three checks are at least amber. */
  flyable: boolean;
}

/* -------------------------------------------------------------- frames */

/** ECI -> Earth-Moon rotating frame (the Moon sits on +X at MOON_DISTANCE). */
function toMap(r: Vec3, t: number, t0: number): MapPoint {
  const a = -moonAngle(t);
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: c * r.x - s * r.y, y: s * r.x + c * r.y, h: (t - t0) / 3600 };
}

/* ------------------------------------------------------ parking orbit */

interface CachedParking {
  info: ParkingOrbit;
  /** The flight, held at the moment it reaches the parking orbit. */
  sim: FlightSim | null;
  /** Seconds kept clear before the burn point (same rule as the flight). */
  lead: number;
}

const parkingCache = new Map<string, CachedParking>();

function cachedParking(rocket: RocketId, parts: PartId[], parkingAltM: number): CachedParking {
  const key = `${rocket}|${[...parts].sort().join(",")}|${Math.round(parkingAltM)}`;
  const hit = parkingCache.get(key);
  if (hit) return hit;

  const sim = new FlightSim(rocket, parts, { parkingAltM, phaseDeg: 0, tliDvMs: 0 });
  sim.holdAtParking = true;
  while (sim.phase !== "parking" && sim.phase !== "failed" && sim.t < 4000) sim.advance(5);

  let entry: CachedParking;
  if (sim.phase !== "parking" || !sim.parkingState) {
    entry = {
      sim: null,
      lead: 0,
      info: {
        state: null,
        periapsisAlt: NaN,
        apoapsisAlt: NaN,
        period: NaN,
        stage2Dv: 0,
        serviceDv: 0,
        available: 0,
        failure: sim.message || "The rocket can't reach this orbit with this spacecraft.",
      },
    };
  } else {
    const o = orbitInfo(sim.parkingState.r, sim.parkingState.v);
    const b = sim.tliBudget();
    entry = {
      sim,
      lead: sim.tliLead(),
      info: {
        state: sim.parkingState,
        periapsisAlt: o.periapsisAlt,
        apoapsisAlt: o.apoapsisAlt,
        period: o.period,
        stage2Dv: b.stage2Dv,
        serviceDv: b.serviceDv,
        available: b.available,
        failure: null,
      },
    };
  }
  if (parkingCache.size > 200) parkingCache.clear();
  parkingCache.set(key, entry);
  return entry;
}

/** Runs the flight's own ascent headless to the parking orbit. Cached per design and height. */
export function parkingOrbit(rocket: RocketId, parts: PartId[], parkingAltM: number): ParkingOrbit {
  return cachedParking(rocket, parts, parkingAltM).info;
}

/**
 * State right after the TLI. Coarse: an instant burn at the burn point (fast, for
 * dragging). Exact: a copy of the flight flies the real, minutes-long burn with the
 * autopilot, so the prediction is what the flight will do.
 */
function afterBurn(cp: CachedParking, plan: OrbitPlan, burn: CoastState, coarse: boolean): CoastState {
  if (coarse || !cp.sim) return { t: burn.t, r: burn.r, v: vadd(burn.v, vscale(vnorm(burn.v), plan.tliDvMs)) };
  const sim = cp.sim.clone();
  sim.plan = plan;
  sim.holdAtParking = false;
  const limit = burn.t + 4 * 3600;
  while ((sim.phase === "parking" || sim.phase === "tli") && sim.t < limit) sim.advance(60);
  return { t: sim.t, r: { ...sim.r }, v: { ...sim.v } };
}

/* ----------------------------------------------------------- predict */

interface Coast {
  outbound: MapPoint[];
  inbound: MapPoint[];
  periluneDist: number;
  periluneT: number;
  perilunePos: Vec3;
  hitsMoon: boolean;
  returnPerigeeAlt: number;
  returnT: number;
}

/**
 * Coasts from just after the burn for up to 12 days. Finds the closest pass by the
 * Moon and, after it, the perigee of the way home. One pass, so it is cheap enough
 * to rerun on every slider move.
 */
function coast(start: CoastState, coarse: boolean): Coast {
  const maxStep = coarse ? 1800 : 300;
  const end = start.t + 12 * 86400;
  let s = start;
  const outbound: MapPoint[] = [toMap(s.r, s.t, start.t)];
  const inbound: MapPoint[] = [];
  let periluneDist = Infinity;
  let periluneT = start.t;
  let perilunePos = s.r;
  let passed = false;
  let hitsMoon = false;
  let returnPerigeeAlt = NaN;
  let returnT = NaN;
  let lastSample = start.t;
  const sampleEvery = coarse ? 3600 : 1200;

  while (s.t < end) {
    s = coastRk4(s, Math.min(coastStep(s.r, s.v, s.t, maxStep), end - s.t));
    const m = moonPosition(s.t);
    const dm = Math.hypot(s.r.x - m.x, s.r.y - m.y, s.r.z - m.z);
    const re = vlen(s.r);
    // Dense near the Earth (for the departure view), then sparser out in space.
    const every = re < 30000000 ? 60 : re < 60000000 || dm < 60000000 ? sampleEvery / 6 : sampleEvery;
    if (s.t - lastSample >= every) {
      (passed ? inbound : outbound).push(toMap(s.r, s.t, start.t));
      lastSample = s.t;
    }
    if (dm < R_MOON) {
      hitsMoon = true;
      perilunePos = s.r;
      periluneDist = dm;
      periluneT = s.t;
      outbound.push(toMap(s.r, s.t, start.t));
      break;
    }
    if (!passed) {
      if (dm < periluneDist) {
        periluneDist = dm;
        periluneT = s.t;
        perilunePos = s.r;
      } else if (dm < 80000000 && dm > periluneDist * 1.02) {
        passed = true;
        inbound.push(toMap(perilunePos, periluneT, start.t));
      }
      // Never got near the Moon and is falling back: no flyby on this pass.
      if (!passed && re < 60000000 && vdot(s.r, s.v) < 0 && s.t - start.t > 86400) break;
      continue;
    }
    if (re > 2 * MOON_DISTANCE) break; // flung out of the Earth-Moon system
    if (re < 60000000 && vdot(s.r, s.v) < 0 && isNaN(returnPerigeeAlt)) {
      // Earth dominates from here: the two-body perigee is a good estimate.
      returnPerigeeAlt = orbitInfo(s.r, s.v).periapsisAlt;
      returnT = s.t + orbitInfo(s.r, s.v).timeToPeriapsis;
      if (!isFinite(returnT)) returnT = s.t;
    }
    if (!isNaN(returnPerigeeAlt) && (re - R_EARTH < 120000 || vdot(s.r, s.v) > 0)) {
      inbound.push(toMap(s.r, s.t, start.t));
      break;
    }
  }
  if (!passed && !hitsMoon) outbound.push(toMap(s.r, s.t, start.t));
  return { outbound, inbound, periluneDist, periluneT, perilunePos, hitsMoon, returnPerigeeAlt, returnT };
}

const km = (m: number) => `${Math.round(m / 1000).toLocaleString("en-US")} km`;

/** Predicts a plan for a design. `coarse` is for live dragging (about twice as fast). */
export function evaluatePlan(
  plan: OrbitPlan,
  rocket: RocketId,
  parts: PartId[],
  opts: { coarse?: boolean } = {},
): PlanResult {
  const cp = cachedParking(rocket, parts, plan.parkingAltM);
  const parking = cp.info;
  if (!parking.state) {
    const bad: Check = { state: "bad", title: "Can't reach orbit", detail: parking.failure ?? "" };
    return {
      parking,
      burn: null,
      waitMin: 0,
      apoapsisAlt: NaN,
      periluneAlt: NaN,
      periluneHours: NaN,
      hitsMoon: false,
      returnPerigeeAlt: NaN,
      returnHours: NaN,
      outbound: [],
      inbound: [],
      burnPoint: null,
      perilunePoint: null,
      checks: { moon: bad, fuel: bad, home: bad },
      flyable: false,
    };
  }

  const burn = findPhaseCrossing(parking.state, plan.phaseDeg, cp.lead);
  const after = afterBurn(cp, plan, burn, !!opts.coarse);
  const apoapsisAlt = orbitInfo(after.r, after.v).apoapsisAlt;
  const c = coast(after, !!opts.coarse);

  const periluneAlt = c.periluneDist - R_MOON;
  const periluneHours = (c.periluneT - burn.t) / 3600;
  const returnHours = (c.returnT - burn.t) / 3600;

  // 1. Does it get to the Moon?
  let moon: Check;
  if (c.hitsMoon) {
    moon = { state: "bad", title: "Crashes into the Moon", detail: `Impact ${periluneHours.toFixed(0)} h after the burn. Move the burn a little later or add a few m/s.` };
  } else if (periluneAlt < PERILUNE_MIN) {
    moon = { state: "bad", title: "Skims the surface", detail: `Passes ${km(periluneAlt)} above the Moon. Move the burn slightly.` };
  } else if (periluneAlt <= PERILUNE_GOOD_MAX) {
    moon = { state: "ok", title: "Swings round the Moon", detail: `Closest pass ${km(periluneAlt)} above the surface, ${(periluneHours / 24).toFixed(1)} days after the burn.` };
  } else if (periluneAlt <= PERILUNE_WEAK_MAX) {
    moon = { state: "warn", title: "Distant pass", detail: `Passes ${km(periluneAlt)} from the Moon: too far for a good swing. Fine-tune the burn angle.` };
  } else if (isFinite(apoapsisAlt) && apoapsisAlt < MOON_DISTANCE - 40000000) {
    moon = { state: "bad", title: "Falls short", detail: `The orbit only reaches ${km(apoapsisAlt)}; the Moon is 384,400 km away. Add delta-v.` };
  } else {
    moon = { state: "bad", title: "Misses the Moon", detail: `Closest pass ${km(periluneAlt)}. The Moon isn't there when you arrive: change the burn angle.` };
  }

  // 2. Is there enough propellant?
  const margin = parking.available - plan.tliDvMs;
  let fuel: Check;
  if (margin >= 100) {
    fuel = { state: "ok", title: "Enough propellant", detail: `${Math.round(margin)} m/s to spare after the burn, plus ${SERVICE_RESERVE_DV} m/s kept for corrections.` };
  } else if (margin >= 0) {
    fuel = { state: "warn", title: "Tight on propellant", detail: `Only ${Math.round(margin)} m/s to spare. Losses in a long burn could eat it.` };
  } else {
    fuel = { state: "bad", title: "Not enough propellant", detail: `The burn needs ${Math.round(plan.tliDvMs)} m/s but only ${Math.round(parking.available)} m/s is left in orbit. Lighter spacecraft, bigger rocket or lower orbit.` };
  }

  // 3. Does it come home?
  let home: Check;
  const pe = c.returnPerigeeAlt;
  if (c.hitsMoon) {
    home = { state: "bad", title: "No way home", detail: "The path ends on the Moon." };
  } else if (moon.state === "bad") {
    home = { state: "bad", title: "No free return", detail: "Without a swing round the Moon the crew doesn't come back on its own." };
  } else if (isNaN(pe)) {
    home = { state: "bad", title: "Doesn't come back", detail: "The Moon flings the spacecraft away from the Earth. Change the burn angle." };
  } else if (pe >= ENTRY_PERIGEE_MIN && pe <= ENTRY_PERIGEE_MAX) {
    home = { state: "ok", title: "Free return", detail: `Comes straight back to a ${km(pe)} re-entry, ${(returnHours / 24).toFixed(1)} days after the burn.` };
  } else if (pe > -R_EARTH * 0.6 && pe < EASY_PERIGEE_MAX) {
    home = {
      state: "ok",
      title: "Free return",
      detail: `Comes back ${pe < 0 ? "slightly too steep" : `${km(pe)} from the Earth`}; the autopilot trims it to a safe re-entry with a small course correction.`,
    };
  } else if (pe > 0 && pe < HARD_PERIGEE_MAX) {
    home = { state: "warn", title: "Wide return", detail: `Comes back ${km(pe)} from the Earth. A large correction is needed to get home: fine-tune the burn angle.` };
  } else {
    home = { state: "bad", title: "Doesn't come back", detail: `The way home passes ${km(pe)} from the Earth. Change the burn angle.` };
  }

  const mapStart = burn.t;
  return {
    parking,
    burn,
    waitMin: (burn.t - parking.state.t) / 60,
    apoapsisAlt,
    periluneAlt,
    periluneHours,
    hitsMoon: c.hitsMoon,
    returnPerigeeAlt: pe,
    returnHours,
    outbound: c.outbound,
    inbound: c.inbound,
    burnPoint: toMap(burn.r, burn.t, mapStart),
    perilunePoint: toMap(c.perilunePos, c.periluneT, mapStart),
    checks: { moon, fuel, home },
    flyable: moon.state !== "bad" && fuel.state !== "bad" && home.state !== "bad",
  };
}

/** Delta-v of an ideal transfer from the parking orbit out to the Moon's distance. */
export function hohmannDv(parkingAltM: number): number {
  const r = R_EARTH + parkingAltM;
  return Math.sqrt(MU_EARTH * (2 / r - 2 / (r + MOON_DISTANCE))) - Math.sqrt(MU_EARTH / r);
}

/** Score of a plan for the search: lower is better. */
function score(p: PlanResult): number {
  const w: Record<Light, number> = { ok: 0, warn: 1, bad: 3 };
  const lights = w[p.checks.moon.state] + w[p.checks.home.state] + w[p.checks.fuel.state];
  const pe = isNaN(p.returnPerigeeAlt) ? 1e9 : Math.abs(p.returnPerigeeAlt - 60000);
  return lights * 1e9 + pe;
}

/**
 * Finds a free-return plan at the plan's parking height: coarse sweep of the burn
 * angle and delta-v, then a finer one around the best. Takes a fraction of a second.
 */
export function suggestPlan(rocket: RocketId, parts: PartId[], parkingAltM: number): OrbitPlan {
  const base = Math.round(hohmannDv(parkingAltM));
  let best: { plan: OrbitPlan; s: number } = { plan: { ...DEFAULT_PLAN, parkingAltM }, s: Infinity };
  const tryPlan = (phaseDeg: number, tliDvMs: number, coarse: boolean) => {
    const plan = { parkingAltM, phaseDeg: (phaseDeg + 360) % 360, tliDvMs };
    const s = score(evaluatePlan(plan, rocket, parts, { coarse }));
    if (s < best.s) best = { plan, s };
  };
  // Coarse sweep with instant burns, then refine with the exact, finite burn.
  for (let ph = 0; ph < 360; ph += 6) for (const d of [-15, 0, 15]) tryPlan(ph, base + d, true);
  let c = best.plan;
  for (let ph = -6; ph <= 6; ph += 1) for (let d = -10; d <= 10; d += 5) tryPlan(c.phaseDeg + ph, c.tliDvMs + d, true);
  c = best.plan;
  best = { plan: c, s: Infinity };
  for (let ph = -2; ph <= 2; ph += 0.5) tryPlan(c.phaseDeg + ph, c.tliDvMs, false);
  c = best.plan;
  for (let d = -6; d <= 6; d += 2) tryPlan(c.phaseDeg, c.tliDvMs + d, false);
  c = best.plan;
  for (const ph of [-0.25, 0.25]) tryPlan(c.phaseDeg + ph, c.tliDvMs, false);

  return { ...best.plan, phaseDeg: Math.round(best.plan.phaseDeg * 4) / 4 };
}
