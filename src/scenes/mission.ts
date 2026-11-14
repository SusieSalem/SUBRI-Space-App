// Flight path for the prototype: launch, one parking orbit, trans-lunar
// injection, a free-return style figure-eight around the Moon, and re-entry.
// Purely visual for now. Scene units: Earth radius = 1. Distances are
// compressed so the Moon is visible from Earth (real distance is ~60 radii).

import * as THREE from "three";

export const EARTH_RADIUS = 1;
export const PARKING_ORBIT_RADIUS = 1.07;
export const MOON_RADIUS = 0.273;
export const MOON_POSITION = new THREE.Vector3(16, 0.6, 0);
export const SUN_DIRECTION = new THREE.Vector3(0.7, 0.25, 0.67).normalize();

export type PhaseId = "idle" | "launch" | "parking" | "tli" | "coast" | "flyby" | "return" | "reentry" | "splashdown";

export interface Phase {
  id: PhaseId;
  label: string;
  /** Seconds of prototype time at 1x speed. */
  duration: number;
  /** Engine running during this phase. */
  burn: boolean;
}

export const PHASES: Phase[] = [
  { id: "launch", label: "Launch and ascent", duration: 7, burn: true },
  { id: "parking", label: "Parking orbit", duration: 9, burn: false },
  { id: "tli", label: "Trans-lunar injection burn", duration: 3, burn: true },
  { id: "coast", label: "Coasting to the Moon", duration: 14, burn: false },
  { id: "flyby", label: "Swinging around the far side", duration: 7, burn: false },
  { id: "return", label: "Coasting home", duration: 14, burn: false },
  { id: "reentry", label: "Re-entry", duration: 4, burn: false },
];

export const MISSION_DURATION = PHASES.reduce((s, p) => s + p.duration, 0);

/** Real mission elapsed time (hours) at the end of each phase, for the HUD. */
const REAL_HOURS_AT_END: Record<PhaseId, number> = {
  idle: 0,
  launch: 0.15,
  parking: 1.5,
  tli: 1.6,
  coast: 72,
  flyby: 100,
  return: 190,
  reentry: 192,
  splashdown: 192,
};

// Orbit plane basis (the whole mission stays roughly in one plane).
const U = new THREE.Vector3(0, 0, 1);
const V = new THREE.Vector3(1, 0, 0);

function onCircle(angle: number, radius: number, out: THREE.Vector3) {
  return out
    .copy(U)
    .multiplyScalar(Math.cos(angle) * radius)
    .addScaledVector(V, Math.sin(angle) * radius);
}

// Figure-eight: out along one side, around the far side of the Moon, back on
// the other side, crossing the outbound path on the way.
const m = MOON_POSITION;
const transferPoints = [
  new THREE.Vector3(0, 0, PARKING_ORBIT_RADIUS),
  new THREE.Vector3(1.2, 0.02, 1.25),
  new THREE.Vector3(4, 0.12, 1.9),
  new THREE.Vector3(8.5, 0.3, 1.3),
  new THREE.Vector3(13.2, 0.5, -0.4),
  new THREE.Vector3(m.x - 0.6, m.y, m.z - 0.62),
  new THREE.Vector3(m.x + 0.5, m.y + 0.05, m.z - 0.38),
  new THREE.Vector3(m.x + 0.62, m.y + 0.05, m.z + 0.3),
  new THREE.Vector3(m.x - 0.4, m.y, m.z + 0.66),
  new THREE.Vector3(13.2, 0.5, 0.5),
  new THREE.Vector3(8.5, 0.3, -1.4),
  new THREE.Vector3(4, 0.12, -1.9),
  new THREE.Vector3(1.4, 0.03, -1.15),
  new THREE.Vector3(0.45, 0.01, -0.92),
];
export const transferCurve = new THREE.CatmullRomCurve3(transferPoints, false, "centripetal", 0.5);

// Where the outbound, flyby and return legs start and end along the curve (0..1).
const LEG_COAST_END = 0.4;
const LEG_FLYBY_END = 0.6;
const LEG_RETURN_END = 0.94;

export interface MissionState {
  phase: PhaseId;
  phaseIndex: number;
  /** 0..1 progress inside the current phase. */
  phaseProgress: number;
  position: THREE.Vector3;
  burning: boolean;
  /** 0..1 plasma glow during re-entry. */
  heat: number;
  realHours: number;
}

const tmp = new THREE.Vector3();

function ease(t: number) {
  return t * t * (3 - 2 * t);
}

/** Where the spacecraft is at prototype time t (seconds since launch). */
export function missionStateAt(t: number, out: MissionState): MissionState {
  if (t <= 0) {
    out.phase = "idle";
    out.phaseIndex = -1;
    out.phaseProgress = 0;
    onCircle(LAUNCH_ANGLE, EARTH_RADIUS + 0.004, out.position);
    out.burning = false;
    out.heat = 0;
    out.realHours = 0;
    return out;
  }

  let start = 0;
  let index = PHASES.length;
  for (let i = 0; i < PHASES.length; i++) {
    if (t < start + PHASES[i].duration) {
      index = i;
      break;
    }
    start += PHASES[i].duration;
  }

  if (index >= PHASES.length) {
    out.phase = "splashdown";
    out.phaseIndex = PHASES.length;
    out.phaseProgress = 1;
    out.position.copy(transferCurve.getPointAt(1));
    out.burning = false;
    out.heat = 0;
    out.realHours = REAL_HOURS_AT_END.splashdown;
    return out;
  }

  const phase = PHASES[index];
  const p = (t - start) / phase.duration;
  out.phase = phase.id;
  out.phaseIndex = index;
  out.phaseProgress = p;
  out.burning = phase.burn;
  out.heat = 0;

  const prevHours = index === 0 ? 0 : REAL_HOURS_AT_END[PHASES[index - 1].id];
  out.realHours = prevHours + (REAL_HOURS_AT_END[phase.id] - prevHours) * p;

  switch (phase.id) {
    case "launch": {
      // Rise from the pad and pitch over into orbit.
      const angle = LAUNCH_ANGLE + PARKING_SWEEP_LAUNCH * p * p;
      const r = EARTH_RADIUS + 0.004 + (PARKING_ORBIT_RADIUS - EARTH_RADIUS - 0.004) * (1 - (1 - p) * (1 - p));
      onCircle(angle, r, out.position);
      break;
    }
    case "parking":
    case "tli": {
      const before = phase.id === "parking" ? 0 : PHASES[1].duration;
      const elapsed = before + p * phase.duration;
      const total = PHASES[1].duration + PHASES[2].duration;
      const angle = LAUNCH_ANGLE + PARKING_SWEEP_LAUNCH + PARKING_SWEEP * (elapsed / total);
      onCircle(angle, PARKING_ORBIT_RADIUS, out.position);
      break;
    }
    case "coast":
      out.position.copy(transferCurve.getPointAt(LEG_COAST_END * ease(p) ** 0.85));
      break;
    case "flyby":
      out.position.copy(transferCurve.getPointAt(LEG_COAST_END + (LEG_FLYBY_END - LEG_COAST_END) * p));
      break;
    case "return":
      out.position.copy(
        transferCurve.getPointAt(LEG_FLYBY_END + (LEG_RETURN_END - LEG_FLYBY_END) * ease(p)),
      );
      break;
    case "reentry":
      out.position.copy(transferCurve.getPointAt(LEG_RETURN_END + (1 - LEG_RETURN_END) * p));
      out.heat = Math.sin(Math.min(p * 1.2, 1) * Math.PI);
      break;
  }
  return out;
}

// The parking orbit ends at angle 0 so it joins the transfer curve smoothly.
const PARKING_SWEEP = Math.PI * 2;
const PARKING_SWEEP_LAUNCH = 0.9;
const LAUNCH_ANGLE = -PARKING_SWEEP - PARKING_SWEEP_LAUNCH;

export function newMissionState(): MissionState {
  return {
    phase: "idle",
    phaseIndex: -1,
    phaseProgress: 0,
    position: new THREE.Vector3(),
    burning: false,
    heat: 0,
    realHours: 0,
  };
}

/** Points to draw the planned path as a line. */
export function plannedPathPoints(): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 64; i++) {
    pts.push(onCircle(-PARKING_SWEEP + (i / 64) * PARKING_SWEEP, PARKING_ORBIT_RADIUS, tmp).clone());
  }
  pts.push(...transferCurve.getSpacedPoints(400));
  return pts;
}
