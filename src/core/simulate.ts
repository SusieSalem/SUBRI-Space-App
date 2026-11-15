// Flight simulation: the rocket and spacecraft as a point mass flying under
// real physics (gravity from the Earth and the Moon, thrust and propellant use
// per stage, drag in a co-rotating atmosphere), plus an autopilot that flies it
// like a real mission: vertical rise, gravity turn, insertion into a parking
// orbit, trans-lunar injection at the right moment, a course correction for a
// free return around the Moon, re-entry and parachutes.
//
// Nothing here draws anything. The scene reads the state and the event list.

import { PARTS_BY_ID, type PartId } from "./design";
import type { RocketId } from "./launchCheck";
import {
  ATMOSPHERE_TOP,
  G0,
  MU_EARTH,
  R_EARTH,
  R_MOON,
  airDensity,
  airVelocity,
  coastRk4,
  coastStep,
  ecefToEci,
  findPhaseCrossing,
  gravity,
  moonPosition,
  moonVelocity,
  orbitInfo,
  pressureRatio,
  propagate,
  vadd,
  vcopy,
  vcross,
  vdot,
  vlen,
  vnorm,
  vscale,
  vsub,
  type CoastState,
  type OrbitInfo,
  type Vec3,
} from "./orbit";
import {
  CAPSULE,
  ESCAPE_TOWER_KG,
  ROCKET_DATA,
  SERVICE_ENGINE,
  SERVICE_PROPELLANT_KG,
  type StageData,
} from "./vehicleData";
import type { OrbitPlan } from "./orbitPlan";

/** Seconds of countdown before liftoff. Mission time t = 0 is the start of the countdown. */
export const COUNTDOWN_S = 10;
export const PARKING_ALT = 185000;
/** Height of the rocket's base above the ground on the launch mount. */
export const MOUNT_HEIGHT = 8;
/** The pad, Earth-fixed: on the equator, the top of the planet in the scene. */
export const PAD_ECEF: Vec3 = { x: 0, y: R_EARTH, z: 0 };

const RETURN_PERIGEE_TARGET = 52000;
const PERILUNE_TARGET = R_MOON + 4500000;
const PHYSICS_DT = 0.02; // 50 Hz
const MAX_G = 4;
/** Service module delta-v kept back for course corrections (m/s). */
/** Delta-v the service module keeps for course corrections (m/s). */
export const SERVICE_RESERVE_DV = 150;
/** Centre-core throttle while strap-on boosters burn (an engineering assumption, not dataset values). */
const CORE_THROTTLE_WITH_BOOSTERS: Record<RocketId, number> = { light: 1, medium: 0.55, heavy: 1 };

export type PieceId = "boosters" | "stage1" | "stage2" | "escapeTower" | "serviceModule";

export type FlightPhase =
  | "prelaunch"
  | "ascent"
  | "parking"
  | "tli"
  | "transit"
  | "tcm"
  | "return"
  | "entry"
  | "parachutes"
  | "splashdown"
  | "failed";

export const PHASE_LABEL: Record<FlightPhase, string> = {
  prelaunch: "Countdown",
  ascent: "Ascent",
  parking: "Parking orbit",
  tli: "Trans-lunar injection burn",
  transit: "Coasting",
  tcm: "Course correction burn",
  return: "Coasting home",
  entry: "Re-entry",
  parachutes: "Parachutes open",
  splashdown: "Splashdown",
  failed: "Mission lost",
};

export interface FlightEvent {
  type: "separation" | "message";
  piece?: PieceId;
  t: number;
  r: Vec3;
  v: Vec3;
  attitude: Vec3;
  text: string;
}

interface Stage {
  data: StageData;
  prop: number;
  attached: boolean;
}

export interface ManualInput {
  /** -1..1 rotation rates. */
  pitch: number;
  yaw: number;
  throttle: number;
}

export class FlightSim {
  t = 0;
  r: Vec3;
  v: Vec3;
  /** Nose direction, ECI unit vector. */
  attitude: Vec3;
  throttle = 0;
  phase: FlightPhase = "prelaunch";
  onPad = true;
  autopilot = true;
  manual: ManualInput = { pitch: 0, yaw: 0, throttle: 0 };
  events: FlightEvent[] = [];
  message = "";

  readonly rocketId: RocketId;
  /** Target height of the circular parking orbit (m). */
  readonly parkingAlt: number;
  /** The player's trans-lunar plan, if they made one in the orbit planner. */
  plan: OrbitPlan | null;
  /** Stop advancing once in the parking orbit (used by the planner). */
  holdAtParking = false;
  readonly hasCapsule: boolean;
  private boosters: Stage | null;
  private stage1: Stage;
  private stage2: Stage;
  private diameter: number;
  private spacecraftDryKg: number;
  private serviceProp: number;
  private serviceAttached: boolean;
  private capsuleKg: number;
  private escapeTower: boolean;

  // Autopilot state
  private tliStart = Infinity;
  private tliEnergy = Infinity;
  private tliCutoff = Infinity;
  private tcmTime = Infinity;
  private tcmDv = 0;
  /** Unit vector for the correction burn (prograde before the flyby, sideways after). */
  private tcmDir: Vec3 = { x: 1, y: 0, z: 0 };
  private tcmDone = 0;
  private flybyPassed = false;
  private planned = false;
  private chuteTime = 0;
  private tcm2Planned = false;
  private circularising = false;
  /** State on reaching the parking orbit (the planner predicts from here). */
  parkingState: CoastState | null = null;
  private lastEcc = Infinity;

  maxG = 0;
  /** 0..1 re-entry heating, for the glow. */
  heat = 0;
  /** Engines producing thrust right now, for the exhaust. */
  burning: { boosters: boolean; stage1: boolean; stage2: boolean; service: boolean } = {
    boosters: false,
    stage1: false,
    stage2: false,
    service: false,
  };

  constructor(rocket: RocketId, parts: PartId[], plan: OrbitPlan | null = null) {
    this.rocketId = rocket;
    this.plan = plan;
    this.parkingAlt = plan?.parkingAltM ?? PARKING_ALT;
    const data = ROCKET_DATA[rocket];
    this.boosters = data.boosters ? { data: data.boosters, prop: data.boosters.propKg, attached: true } : null;
    this.stage1 = { data: data.stage1, prop: data.stage1.propKg, attached: true };
    this.stage2 = { data: data.stage2, prop: data.stage2.propKg, attached: true };
    this.diameter = data.diameter;

    this.hasCapsule = parts.includes("capsule");
    const service = parts.includes("serviceLarge") ? "serviceLarge" : parts.includes("serviceSmall") ? "serviceSmall" : null;
    this.serviceProp = service ? SERVICE_PROPELLANT_KG[service] : 0;
    this.serviceAttached = service !== null;
    const total = parts.reduce((s, id) => s + PARTS_BY_ID[id].massKg, 0);
    this.capsuleKg = this.hasCapsule ? PARTS_BY_ID.capsule.massKg : 0;
    this.spacecraftDryKg = total - this.serviceProp;
    this.escapeTower = this.hasCapsule;

    this.r = ecefToEci({ x: PAD_ECEF.x, y: PAD_ECEF.y + MOUNT_HEIGHT, z: PAD_ECEF.z }, 0);
    this.v = airVelocity(this.r);
    this.attitude = vnorm(this.r);
  }

  /* ------------------------------------------------------------ queries */

  get mass(): number {
    let m = this.serviceAttached ? this.spacecraftDryKg + this.serviceProp : this.capsuleKg;
    if (this.escapeTower) m += ESCAPE_TOWER_KG;
    for (const s of [this.boosters, this.stage1, this.stage2]) if (s && s.attached) m += s.data.dryKg + s.prop;
    return m;
  }
  get altitude() {
    return vlen(this.r) - R_EARTH;
  }
  get up() {
    return vnorm(this.r);
  }
  /** Speed relative to the ground/air. */
  get surfaceSpeed() {
    return vlen(vsub(this.v, airVelocity(this.r)));
  }
  get verticalSpeed() {
    return vdot(this.v, this.up);
  }
  get orbitalSpeed() {
    return vlen(this.v);
  }
  orbit(): OrbitInfo {
    return orbitInfo(this.r, this.v);
  }
  get moonDistance() {
    const m = moonPosition(this.t);
    return vlen(vsub(this.r, m)) - R_MOON;
  }
  get attached() {
    return {
      boosters: !!this.boosters?.attached,
      stage1: this.stage1.attached,
      stage2: this.stage2.attached,
      escapeTower: this.escapeTower,
      serviceModule: this.serviceAttached,
    };
  }
  /** Fuel left in the stage currently doing the work, 0..1, and its name. */
  get fuel(): { name: string; fraction: number } {
    if (this.boosters?.attached) return { name: "Boosters", fraction: this.boosters.prop / this.boosters.data.propKg };
    if (this.stage1.attached) return { name: "First stage", fraction: this.stage1.prop / this.stage1.data.propKg };
    if (this.stage2.attached) return { name: "Upper stage", fraction: this.stage2.prop / this.stage2.data.propKg };
    const max = this.serviceAttached ? Math.max(1, this.serviceProp + this.tcmDone) : 1;
    return { name: "Service module", fraction: this.serviceAttached ? this.serviceProp / max : 0 };
  }
  /** Largest time warp allowed right now. */
  get maxWarp(): number {
    if (this.phase === "splashdown" || this.phase === "failed") return 1;
    if (this.phase === "parachutes") return 50;
    if (this.onPad || this.throttle > 0 || this.altitude < ATMOSPHERE_TOP) return 4;
    return 100000;
  }
  /** Time until the next thing the autopilot will do (for auto warp). */
  get timeToNextEvent(): number {
    const next = Math.min(this.tliStart, this.tcmTime);
    if (this.phase === "prelaunch") return COUNTDOWN_S - this.t;
    if (this.phase === "return" || this.phase === "transit") {
      // Time to atmosphere entry, roughly, when heading down.
      const alt = this.altitude;
      const vv = this.verticalSpeed;
      const toEntry = vv < 0 ? (alt - ATMOSPHERE_TOP) / -vv : Infinity;
      const toMoon = this.moonDistance / Math.max(1, vlen(vsub(this.v, moonVelocity(this.t))));
      return Math.min(next - this.t, toEntry, this.flybyPassed ? Infinity : toMoon * 0.5);
    }
    return next - this.t;
  }

  /* ----------------------------------------------------------- stepping */

  /** Advances the simulation by `seconds` of mission time. */
  advance(seconds: number) {
    let remaining = seconds;
    let guard = 0;
    while (remaining > 1e-9 && guard++ < 200000) {
      if (this.phase === "splashdown" || this.phase === "failed") return;
      if (this.holdAtParking && this.phase === "parking") return;
      const fine = this.onPad || this.throttle > 0 || this.altitude < ATMOSPHERE_TOP || this.phase === "prelaunch";
      let dt: number;
      if (fine) {
        dt = Math.min(PHYSICS_DT, remaining);
        this.guide(dt);
        this.stepPowered(dt);
      } else {
        dt = Math.min(coastStep(this.r, this.v, this.t, 300), remaining);
        const tNext = Math.min(this.tliStart, this.tcmTime);
        if (tNext > this.t && tNext - this.t < dt) dt = Math.max(PHYSICS_DT, tNext - this.t);
        this.guide(dt);
        if (this.throttle > 0) {
          dt = Math.min(PHYSICS_DT, remaining);
          this.stepPowered(dt);
        } else {
          const s = coastRk4({ t: this.t, r: this.r, v: this.v }, dt);
          this.t = s.t;
          this.r = s.r;
          this.v = s.v;
          if (this.autopilot && (this.phase === "transit" || this.phase === "parking" || this.phase === "return"))
            this.pointAlong(this.v);
        }
      }
      remaining -= dt;
    }
  }

  private emit(type: FlightEvent["type"], text: string, piece?: PieceId) {
    this.events.push({ type, piece, t: this.t, r: vcopy(this.r), v: vcopy(this.v), attitude: vcopy(this.attitude), text });
    if (type === "message" || piece) this.message = text;
  }

  private separate(piece: PieceId, text: string) {
    this.emit("separation", text, piece);
  }

  private pointAlong(dir: Vec3) {
    const d = vnorm(dir);
    if (vlen(dir) > 1e-6) this.attitude = d;
  }

  /** Physics step with thrust and drag (semi-implicit Euler at 50 Hz). */
  private stepPowered(dt: number) {
    const alt = this.altitude;
    const p = pressureRatio(alt);
    let thrust = 0;
    let mdot = 0;
    this.burning = { boosters: false, stage1: false, stage2: false, service: false };

    // Crewed flights keep the load under ~4 g: liquid engines throttle back near burnout.
    const massNow = this.mass;
    const fullThrust = this.currentThrustAcc() * massNow;
    const gLimit = fullThrust > 0 ? Math.min(1, (MAX_G * G0 * massNow) / fullThrust) : 1;
    const use = (s: Stage | null, key: "boosters" | "stage1" | "stage2") => {
      if (!s || !s.attached || s.prop <= 0) return;
      const tv = s.data.thrustVacN;
      const ts = s.data.thrustSlN;
      const isp = s.data.ispSl * p + s.data.ispVac * (1 - p);
      const f = (ts * p + tv * (1 - p)) * this.throttle * gLimit;
      const flow = f / (isp * G0);
      thrust += f;
      mdot += flow;
      s.prop = Math.max(0, s.prop - flow * dt);
      this.burning[key] = f > 0;
    };

    if (this.throttle > 0) {
      if (this.boosters?.attached) {
        use(this.boosters, "boosters");
        // A liquid centre core (Medium, Falcon Heavy-style) throttles down while the side
        // boosters burn so it has propellant left after they drop away.
        const t0 = this.throttle;
        this.throttle = t0 * CORE_THROTTLE_WITH_BOOSTERS[this.rocketId];
        use(this.stage1, "stage1");
        this.throttle = t0;
      } else if (this.stage1.attached) use(this.stage1, "stage1");
      else if (this.stage2.attached) use(this.stage2, "stage2");
      else if (this.serviceAttached && this.serviceProp > 0) {
        const f = SERVICE_ENGINE.thrustN * this.throttle;
        const flow = f / (SERVICE_ENGINE.isp * G0);
        thrust = f;
        mdot = flow;
        this.serviceProp = Math.max(0, this.serviceProp - flow * dt);
        this.burning.service = true;
      }
    }

    const m = this.mass;
    const g = gravity(this.r, this.t);
    const acc = vadd(g, vscale(this.attitude, thrust / m));

    // Drag against the air, which turns with the Earth.
    const vrel = vsub(this.v, airVelocity(this.r));
    const sp = vlen(vrel);
    const rho = airDensity(alt);
    let cda: number;
    const capsuleOnly = !this.stage2.attached && !this.serviceAttached && this.hasCapsule;
    if (capsuleOnly) {
      const bare = CAPSULE.dragCoefficient * Math.PI * (CAPSULE.diameter / 2) ** 2;
      // Drogues first, then the mains open over about 20 s, so there is no sudden jolt.
      const k = this.phase === "parachutes" ? Math.min(1, (this.t - this.chuteTime) / 20) : 0;
      cda = bare + (CAPSULE.parachuteCdA - bare) * k * k * k;
    } else {
      const d = this.boosters?.attached ? this.diameter * 1.8 : this.diameter;
      cda = 0.45 * Math.PI * (d / 2) ** 2;
    }
    if (sp > 0 && rho > 0) {
      const drag = 0.5 * rho * sp * sp * cda;
      acc.x -= (vrel.x / sp) * (drag / m);
      acc.y -= (vrel.y / sp) * (drag / m);
      acc.z -= (vrel.z / sp) * (drag / m);
      if (this.phase === "entry") {
        this.heat = Math.min(1, (rho * sp * sp * sp) / 6e8);
        // Offset centre of mass gives the capsule some lift (L/D ~0.3). Point it up while
        // diving to stretch out the deceleration, down if it starts to climb back out.
        const lift = drag * 0.3;
        const upPerp = vsub(this.up, vscale(vrel, vdot(this.up, vrel) / (sp * sp)));
        const lp = vlen(upPerp);
        if (lp > 1e-6) {
          const sign = this.verticalSpeed < 0 ? 1 : -1;
          acc.x += (upPerp.x / lp) * sign * (lift / m);
          acc.y += (upPerp.y / lp) * sign * (lift / m);
          acc.z += (upPerp.z / lp) * sign * (lift / m);
        }
      }
    } else if (this.phase === "entry") this.heat = 0;

    // Load factor felt by the crew (non-gravitational acceleration).
    const felt = vlen(vsub(acc, g)) / G0;
    if (!this.onPad) this.maxG = Math.max(this.maxG, felt);

    if (this.onPad) {
      // Held down on the pad until the engines are up and the clamps let go.
      this.t += dt;
      this.r = ecefToEci({ x: PAD_ECEF.x, y: PAD_ECEF.y + MOUNT_HEIGHT, z: PAD_ECEF.z }, this.t);
      this.v = airVelocity(this.r);
      this.attitude = vnorm(this.r);
      const weight = m * vlen(g);
      if (this.t >= COUNTDOWN_S && thrust > weight * 1.05) {
        this.onPad = false;
        this.phase = "ascent";
        this.emit("message", "Liftoff");
      }
      return;
    }

    this.v = vadd(this.v, vscale(acc, dt));
    this.r = vadd(this.r, vscale(this.v, dt));
    this.t += dt;
    if (mdot > 0 && this.phase === "tcm") this.tcmDone += (thrust / m) * dt;

    this.checkStaging();

    // Ground contact.
    if (this.altitude <= 0) {
      if (this.phase === "parachutes" && sp < 20) {
        this.phase = "splashdown";
        this.v = airVelocity(this.r);
        this.throttle = 0;
        this.emit("message", "Splashdown. The crew is home.");
      } else {
        this.phase = "failed";
        this.throttle = 0;
        this.emit("message", `Vehicle lost: hit the ground at ${Math.round(sp)} m/s.`);
      }
    }
  }

  private checkStaging() {
    if (this.boosters?.attached && this.boosters.prop <= 0) {
      this.boosters.attached = false;
      this.separate("boosters", "Booster separation");
    }
    if (!this.boosters?.attached && this.stage1.attached && this.stage1.prop <= 0) {
      this.stage1.attached = false;
      this.separate("stage1", "First stage separation");
    }
    if (this.escapeTower && this.altitude > 80000) {
      this.escapeTower = false;
      this.separate("escapeTower", "Escape tower jettison");
    }
  }

  /* ------------------------------------------------------------ autopilot */

  private guide(dt: number) {
    const t = this.t;
    if (this.phase === "prelaunch") {
      // Ignition 3 s before liftoff, ramping up.
      this.throttle = t < COUNTDOWN_S - 3 ? 0 : Math.min(1, (t - (COUNTDOWN_S - 3)) / 1.5);
      return;
    }

    if (!this.autopilot) {
      this.manualControl(dt);
      return;
    }

    switch (this.phase) {
      case "ascent":
        this.ascentGuidance();
        break;
      case "parking":
        this.throttle = 0;
        if (!this.planned) {
          this.planned = true;
          this.planTli();
        }
        if (t >= this.tliStart) {
          this.phase = "tli";
          this.emit("message", "Trans-lunar injection: upper stage relight");
        }
        break;
      case "tli": {
        this.pointAlong(this.v);
        const energy = vdot(this.v, this.v) / 2 - MU_EARTH / vlen(this.r);
        // Upper stage first; if it runs dry, drop it and finish with the service module.
        if (this.stage2.attached && this.stage2.prop <= 0 && energy < this.tliEnergy && this.serviceAttached) {
          this.stage2.attached = false;
          this.separate("stage2", "Upper stage spent. The service module finishes the burn.");
        }
        const serviceReserveKg = this.serviceReserveKg();
        const hasFuel =
          (this.stage2.attached && this.stage2.prop > 0) || (this.serviceAttached && this.serviceProp > serviceReserveKg);
        this.throttle = energy < this.tliEnergy && hasFuel ? 1 : 0;
        if (this.throttle === 0) {
          this.phase = "transit";
          this.tliCutoff = t;
          this.tliStart = Infinity;
          // Upper stage already gone (service module finished the burn): plan the correction now.
          if (!this.stage2.attached) this.tcmTime = t + 3 * 3600;
          if (energy < this.tliEnergy) this.emit("message", "Upper stage out of propellant before reaching the Moon's distance");
          else this.emit("message", "Engine cutoff. On the way to the Moon.");
        }
        break;
      }
      case "transit":
        this.throttle = 0;
        if (this.stage2.attached && t > this.tliCutoff + 60) {
          this.stage2.attached = false;
          this.separate("stage2", "Spacecraft separation from the upper stage");
          this.tcmTime = t + 3 * 3600;
        }
        if (t >= this.tcmTime) {
          this.tcmTime = Infinity;
          this.planTcm();
          if (Math.abs(this.tcmDv) > 0.05 && this.serviceAttached && this.serviceProp > 0) {
            this.phase = "tcm";
            this.tcmDone = 0;
            this.emit("message", `Course correction: ${this.tcmDv.toFixed(1)} m/s for a free return`);
          }
        }
        this.checkFlybyAndReturn();
        break;
      case "tcm": {
        this.pointAlong(vscale(this.tcmDir, this.tcmDv >= 0 ? 1 : -1));
        this.throttle = this.tcmDone < Math.abs(this.tcmDv) && this.serviceProp > 0 ? 1 : 0;
        if (this.throttle === 0) {
          this.phase = "transit";
          this.emit("message", "Course correction complete");
        }
        break;
      }
      case "return":
        this.throttle = 0;
        if (this.altitude < ATMOSPHERE_TOP) {
          this.phase = "entry";
          this.emit("message", "Entry interface");
        }
        break;
      case "entry":
        this.throttle = 0;
        // Heat shield first.
        this.pointAlong(vscale(vsub(this.v, airVelocity(this.r)), -1));
        if (this.altitude < 9000 && this.surfaceSpeed < 250) {
          this.phase = "parachutes";
          this.chuteTime = this.t;
          this.emit("message", "Parachutes deployed");
        }
        break;
      case "parachutes":
        this.throttle = 0;
        this.pointAlong(vscale(vsub(this.v, airVelocity(this.r)), -1));
        break;
    }
  }

  private checkFlybyAndReturn() {
    const m = moonPosition(this.t);
    const rel = vsub(this.r, m);
    const relV = vsub(this.v, moonVelocity(this.t));
    if (!this.flybyPassed && vlen(rel) < 60000000 && vdot(rel, relV) > 0) {
      this.flybyPassed = true;
      this.emit("message", `Closest approach to the Moon: ${Math.round((vlen(rel) - R_MOON) / 1000)} km`);
    }
    // Second correction on the way home to fine-tune the entry angle.
    if (this.flybyPassed && !this.tcm2Planned && this.altitude < 200000000 && this.verticalSpeed < 0) {
      this.tcm2Planned = true;
      this.tcmTime = this.t;
    }
    if (this.flybyPassed && this.altitude < 6000000 && this.verticalSpeed < 0) {
      this.phase = "return";
      if (this.serviceAttached) {
        this.serviceAttached = false;
        this.separate("serviceModule", "Service module separation. Capsule on its own for re-entry.");
      }
    }
  }

  /** Open-loop gravity turn low down, then closed-loop guidance straight into a circular orbit. */
  private ascentGuidance() {
    const up = this.up;
    const alt = this.altitude;
    const east = vnorm(airVelocity(this.r));
    const vv = this.verticalSpeed;
    const horiz = vsub(this.v, vscale(up, vv));
    const vh = vlen(horiz);
    const hdir = vh > 1 ? vscale(horiz, 1 / vh) : east;
    const orbit = this.orbit();

    const target = this.parkingAlt;

    if (orbit.periapsisAlt > Math.min(target - 12000, alt - 6000)) {
      this.enterParking(orbit);
      return;
    }

    // Apoapsis at the target height: stop climbing, coast up to it and circularise
    // there (like a real perigee-raise burn). Without this a powerful first stage
    // overshoots into a long ellipse instead of the parking orbit the plan asked for.
    if (alt > 50000 && (this.circularising || orbit.apoapsisAlt >= target - 2000)) {
      const r = vlen(this.r);
      const rApo = R_EARTH + Math.max(orbit.apoapsisAlt, alt);
      const vAtApo = Math.sqrt(Math.max(0, MU_EARTH * (2 / rApo - 1 / orbit.semiMajorAxis)));
      const dvCirc = Math.max(0, Math.sqrt(MU_EARTH / rApo) - vAtApo);
      const acc = Math.max(this.currentThrustAcc(), 0.1);
      if (!this.circularising && (vv <= 0 || orbit.timeToApoapsis <= dvCirc / acc / 2)) {
        this.circularising = true;
        this.lastEcc = Infinity;
      }
      if (!this.circularising) {
        this.throttle = 0;
        this.attitude = hdir;
        return;
      }
      // Burning prograde near apoapsis lowers the eccentricity until the orbit is
      // round; once it starts to grow again the orbit is as circular as it gets.
      const e = orbit.eccentricity;
      if (e > this.lastEcc && e < 0.03) {
        this.enterParking(orbit);
        return;
      }
      this.lastEcc = e;
      this.throttle = 1;
      // Hold the height while the burn builds up the horizontal speed.
      const gEff = MU_EARTH / (r * r) - (vh * vh) / r;
      const vvWanted = Math.max(-60, Math.min(60, (target - alt) / 60));
      const sUp = Math.max(-0.5, Math.min(0.85, (gEff + (vvWanted - vv) / 10) / acc));
      this.attitude = vnorm(vadd(vscale(up, sUp), vscale(hdir, Math.sqrt(1 - sUp * sUp))));
      if (!this.stage1.attached && this.stage2.prop <= 0) {
        this.phase = "failed";
        this.throttle = 0;
        this.emit("message", "Upper stage out of propellant before orbit. The rocket is too small for this load.");
      }
      return;
    }
    this.throttle = 1;

    if (this.surfaceSpeed < 60 || alt < 300) {
      this.attitude = up;
    } else if (this.stage1.attached && alt < 50000) {
      // Pitch over gradually as the air thins.
      const k = Math.min(1, (alt - 300) / 52000);
      const pitch = (Math.PI / 2) * 0.86 * Math.pow(k, 0.6);
      this.attitude = vnorm(vadd(vscale(up, Math.cos(pitch)), vscale(east, Math.sin(pitch))));
    } else {
      // Spread the remaining climb over the time left until orbital speed, so the
      // rocket arrives at the target height just as it gets fast enough.
      const thrustAcc = this.currentThrustAcc();
      const r = vlen(this.r);
      const vCirc = Math.sqrt(MU_EARTH / r);
      const tGo = Math.max(25, (vCirc - vh) / Math.max(thrustAcc, 0.3));
      const vvWanted = Math.max(-40, Math.min(400, (target - alt) / tGo));
      const gEff = MU_EARTH / (r * r) - (vh * vh) / r;
      const wantUp = gEff + (vvWanted - vv) / 10;
      const s = Math.max(-0.4, Math.min(0.85, wantUp / Math.max(thrustAcc, 0.1)));
      this.attitude = vnorm(vadd(vscale(up, s), vscale(hdir, Math.sqrt(1 - s * s))));
    }

    if (!this.stage1.attached && this.stage2.prop <= 0) {
      this.phase = "failed";
      this.throttle = 0;
      this.emit("message", "Upper stage out of propellant before orbit. The rocket is too small for this load.");
    }
  }

  /** Engines off in the parking orbit. Lower stages still attached are dropped. */
  private enterParking(orbit: OrbitInfo) {
    this.throttle = 0;
    this.phase = "parking";
    this.parkingState = { t: this.t, r: vcopy(this.r), v: vcopy(this.v) };
    if (this.boosters?.attached) {
      this.boosters.attached = false;
      this.separate("boosters", "Booster separation");
    }
    if (this.stage1.attached) {
      this.stage1.attached = false;
      this.separate("stage1", "First stage separation");
    }
    this.emit("message", `Orbit reached: ${Math.round(orbit.periapsisAlt / 1000)} x ${Math.round(orbit.apoapsisAlt / 1000)} km`);
  }

  /** Propellant the service module must keep for course corrections. */
  private serviceReserveKg(): number {
    const ve = SERVICE_ENGINE.isp * G0;
    return this.mass * (1 - Math.exp(-SERVICE_RESERVE_DV / ve));
  }

  private currentThrustAcc(): number {
    const p = pressureRatio(this.altitude);
    let f = 0;
    if (this.boosters?.attached) f += this.boosters.data.thrustSlN * p + this.boosters.data.thrustVacN * (1 - p);
    if (this.stage1.attached) f += this.stage1.data.thrustSlN * p + this.stage1.data.thrustVacN * (1 - p);
    else if (this.stage2.attached) f += this.stage2.data.thrustVacN;
    return f / this.mass;
  }

  private manualControl(dt: number) {
    const rate = 0.6 * dt; // rad/s at full input
    const up = this.up;
    const side = vcross(this.attitude, up);
    let a = this.attitude;
    // Pitch tilts the nose towards or away from straight up; yaw swings it sideways.
    if (this.manual.pitch) a = vnorm(vadd(a, vscale(up, -this.manual.pitch * rate)));
    if (this.manual.yaw && vlen(side) > 0.05) a = vnorm(vadd(a, vscale(vnorm(side), this.manual.yaw * rate)));
    this.attitude = a;
    this.throttle = Math.max(0, Math.min(1, this.manual.throttle));
    if (this.phase === "ascent" && this.orbit().periapsisAlt > 120000) this.phase = "parking";
  }

  /* ------------------------------------------------------------- planning */

  /** Chooses when to start the TLI burn so the coast passes close to the Moon. */
  /**
   * Delta-v left for the trans-lunar injection (rocket equation): the upper stage,
   * then the service module, which keeps a reserve for course corrections.
   */
  tliBudget(): { stage2Dv: number; serviceDv: number; available: number } {
    const ve = this.stage2.data.ispVac * G0;
    const stage2Dv = this.stage2.attached ? ve * Math.log(this.mass / (this.mass - this.stage2.prop)) : 0;
    const massAfterStage2 = this.mass - (this.stage2.attached ? this.stage2.data.dryKg + this.stage2.prop : 0);
    const serviceDv = this.serviceAttached && this.serviceProp > 0
      ? SERVICE_ENGINE.isp * G0 * Math.log(massAfterStage2 / (massAfterStage2 - this.serviceProp))
      : 0;
    return { stage2Dv, serviceDv, available: stage2Dv + Math.max(0, serviceDv - SERVICE_RESERVE_DV) };
  }

  /** Finite burn time for a TLI of `dv`: upper stage first, then the service module. */
  tliBurnTime(dv: number): number {
    const { stage2Dv } = this.tliBudget();
    const ve = this.stage2.data.ispVac * G0;
    const massAfterStage2 = this.mass - (this.stage2.attached ? this.stage2.data.dryKg + this.stage2.prop : 0);
    const dv2 = Math.min(dv, stage2Dv);
    const t2 = this.stage2.attached ? (this.mass * (1 - Math.exp(-dv2 / ve))) / (this.stage2.data.thrustVacN / ve) : 0;
    const dvS = Math.max(0, dv - dv2);
    const veS = SERVICE_ENGINE.isp * G0;
    const tS = dvS > 0 ? (massAfterStage2 * (1 - Math.exp(-dvS / veS))) / (SERVICE_ENGINE.thrustN / veS) : 0;
    return t2 + tS;
  }

  /** Seconds to keep clear before the burn point, so a burn centred on it can start in time. */
  tliLead(): number {
    return 60 + this.tliBurnTime(3300) / 2;
  }

  /** An independent copy of the simulation, to try a plan without touching this one. */
  clone(): FlightSim {
    const c = Object.create(FlightSim.prototype) as FlightSim;
    return Object.assign(c, structuredClone({ ...this }));
  }

  /** Flies the player's plan: burn its delta-v where the Moon is the chosen angle ahead. */
  private planTliFromPlan(plan: OrbitPlan) {
    const start = this.parkingState ?? { t: this.t, r: vcopy(this.r), v: vcopy(this.v) };
    const burn = findPhaseCrossing(start, plan.phaseDeg, this.tliLead());
    const r = vlen(burn.r);
    const speed = vlen(burn.v) + plan.tliDvMs;
    this.tliStart = Math.max(this.t, burn.t - this.tliBurnTime(plan.tliDvMs) / 2);
    this.tliEnergy = (speed * speed) / 2 - MU_EARTH / r;
    this.emit(
      "message",
      `Your plan: trans-lunar injection in ${Math.round((this.tliStart - this.t) / 60)} min (${Math.round(plan.tliDvMs)} m/s)`,
    );
  }

  private planTli() {
    if (this.plan) {
      this.planTliFromPlan(this.plan);
      return;
    }
    const start: CoastState = { t: this.t, r: vcopy(this.r), v: vcopy(this.v) };
    const info = orbitInfo(start.r, start.v);
    const period = isFinite(info.period) ? info.period : 5400;
    const { available } = this.tliBudget();
    // On an eccentric orbit the burn is far cheaper near perigee, so look over a few orbits.
    const orbits = info.eccentricity > 0.02 ? 4 : 1.05;
    const samples = Math.round(150 * Math.min(orbits, 2));
    let best = { score: Infinity, t: Infinity, energy: Infinity, dv: 0, miss: 0 };
    let s = advanceCoast(start, 300);
    for (let k = 0; k < samples; k++) {
      const r = vlen(s.r);
      const speed = vlen(s.v);
      for (const raFactor of [0.97, 1.04]) {
        const ra = 384400000 * raFactor;
        const vNeeded = Math.sqrt(MU_EARTH * (2 / r - 2 / (r + ra)));
        const dv = vNeeded - speed;
        // Leave ~6% margin for finite-burn losses.
        if (dv > available * 0.94) continue;
        const res = propagate({ t: s.t, r: s.r, v: vscale(vnorm(s.v), vNeeded) }, 6 * 86400, { stopAlt: -1e9, maxStep: 900 });
        if (res.hitMoon) continue;
        // Among departures that really reach the Moon (within ~15,000 km of the target pass),
        // prefer the cheapest; a bigger miss is only taken if nothing better exists.
        const miss = Math.abs(res.minMoonDist - PERILUNE_TARGET);
        const score = (miss > 15000000 ? 1000 + miss / 1e6 : miss / 1e6) + dv / 25;
        if (score < best.score) best = { score, t: s.t, energy: (vNeeded * vNeeded) / 2 - MU_EARTH / r, dv, miss: res.minMoonDist - R_MOON };
      }
      s = advanceCoast(s, (period * orbits) / samples);
    }
    if (!isFinite(best.t)) {
      this.tliStart = Infinity;
      this.emit("message", "No trans-lunar injection possible: the upper stage does not have enough propellant left.");
      return;
    }
    // Finite burn: start half the burn time before the impulsive point.
    this.tliStart = best.t - this.tliBurnTime(best.dv) / 2;
    this.tliEnergy = best.energy;
    this.emit("message", `Trans-lunar injection planned in ${Math.round((this.tliStart - this.t) / 60)} min (${Math.round(best.dv)} m/s, passing ${Math.round(best.miss / 1000)} km from the Moon)`);
  }

  /** Prograde/retrograde correction that brings the return perigee down to ~45 km. */
  private planTcm() {
    const base: CoastState = { t: this.t, r: vcopy(this.r), v: vcopy(this.v) };
    const after = this.flybyPassed;
    // On the way home the velocity points almost straight at the Earth, so a sideways
    // (in-plane, perpendicular) burn changes the perigee far more than a prograde one.
    const dir = after ? vnorm(vcross(vcross(this.r, this.v), this.v)) : vnorm(this.v);
    this.tcmDir = dir;
    const f = (dv: number) => returnPerigee(base, vscale(dir, dv), after) - RETURN_PERIGEE_TARGET;
    let bestDv = 0;
    const f0 = f(0);
    // NaN means the uncorrected path hits (or skims) the Moon: any valid correction is better.
    let bestErr = Number.isFinite(f0) ? Math.abs(f0) : Infinity;
    // Before the flyby the return is extremely sensitive to small burns, so sample finely
    // near zero and coarsely further out. After the flyby the response is smooth.
    const samples: number[] = [];
    if (after) {
      for (let dv = -120; dv <= 120; dv += 3) samples.push(dv);
    } else {
      for (let dv = -60; dv < -10; dv += 4) samples.push(dv);
      for (let dv = -10; dv <= 10; dv += 0.5) samples.push(dv);
      for (let dv = 14; dv <= 60; dv += 4) samples.push(dv);
    }
    let prevDv = samples[0];
    let prevF = f(prevDv);
    for (const dv of samples.slice(1)) {
      const fv = f(dv);
      if (Math.abs(fv) < bestErr) {
        bestErr = Math.abs(fv);
        bestDv = dv;
      }
      if (isFinite(fv) && isFinite(prevF) && Math.sign(fv) !== Math.sign(prevF)) {
        let lo = prevDv;
        let hi = dv;
        let flo = prevF;
        for (let i = 0; i < 30; i++) {
          const mid = (lo + hi) / 2;
          const fm = f(mid);
          if (Math.sign(fm) === Math.sign(flo)) {
            lo = mid;
            flo = fm;
          } else hi = mid;
        }
        const cand = (lo + hi) / 2;
        if (Math.abs(cand) < Math.abs(bestDv) || bestErr > 5000) {
          bestDv = cand;
          bestErr = Math.abs(f(cand));
        }
      }
      prevDv = dv;
      prevF = fv;
    }
    this.tcmDv = bestDv;
  }

  /** Predicted path for drawing, as ECI points. */
  predict(duration: number, points = 400): Vec3[] {
    const res = propagate({ t: this.t, r: this.r, v: this.v }, duration, {
      stopAlt: 0,
      samplePoints: points,
      maxStep: Math.max(30, duration / points),
    });
    return res.points ?? [];
  }

  /* -------------------------------------------------------------- inputs */

  setManual(input: Partial<ManualInput>) {
    this.manual = { ...this.manual, ...input };
  }

  setAutopilot(on: boolean) {
    this.autopilot = on;
    if (!on) this.manual.throttle = this.throttle;
  }
}

function advanceCoast(s: CoastState, seconds: number): CoastState {
  let st = s;
  const end = s.t + seconds;
  while (st.t < end) st = coastRk4(st, Math.min(coastStep(st.r, st.v, st.t, 60), end - st.t));
  return st;
}

/** Vacuum perigee altitude of the return leg after applying dv along the velocity now. */
export function returnPerigee(base: CoastState, dv: Vec3, afterFlyby = false): number {
  let s: CoastState = { t: base.t, r: vcopy(base.r), v: vadd(base.v, dv) };
  const end = base.t + 9 * 86400;
  let passedMoon = afterFlyby;
  let prevMoonDist = Infinity;
  while (s.t < end) {
    s = coastRk4(s, coastStep(s.r, s.v, s.t, 300));
    const m = moonPosition(s.t);
    const dm = Math.hypot(s.r.x - m.x, s.r.y - m.y, s.r.z - m.z);
    if (dm < R_MOON + 250000) return NaN; // passes too close to (or into) the Moon
    if (!passedMoon) {
      if (dm > prevMoonDist && dm < 80000000) {
        passedMoon = true;
        // Only accept flybys that actually swing round the Moon (not a distant miss).
        if (prevMoonDist > R_MOON + 20000000) return NaN;
      }
      prevMoonDist = dm;
      continue;
    }
    const r = vlen(s.r);
    if (r < 60000000 && vdot(s.r, s.v) < 0) {
      // Earth dominates from here: two-body perigee is a good estimate.
      return orbitInfo(s.r, s.v).periapsisAlt;
    }
  }
  return 1e9; // never came back
}

