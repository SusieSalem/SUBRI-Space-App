// Orbital mechanics for the flight: constants, gravity from Earth and the Moon,
// the atmosphere, orbit elements and a trajectory propagator.
//
// Frame: Earth-centred inertial (ECI), metres and seconds, double precision.
// The Earth spins about -Z, so a point on the equator moves towards +X ("east"
// at the pad). The Moon orbits in the XY plane, so a due-east launch from the
// equator keeps the whole mission in one plane.
// Plain TypeScript, no rendering code, so it can be tested in Node.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const vcopy = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });
export const vadd = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const vsub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const vscale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const vdot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const vcross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const vlen = (a: Vec3) => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export const vnorm = (a: Vec3): Vec3 => {
  const l = vlen(a) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

/* ------------------------------------------------------------ constants */

export const MU_EARTH = 3.986004418e14;
export const R_EARTH = 6371000;
export const MU_MOON = 4.9048695e12;
export const R_MOON = 1737400;
export const MOON_DISTANCE = 384400000;
/** Sidereal rotation rate of the Earth, rad/s. */
export const EARTH_ROTATION = 7.2921159e-5;
export const G0 = 9.80665;

/** Top of the modelled atmosphere. */
export const ATMOSPHERE_TOP = 140000;
const SCALE_HEIGHT = 8500;
const RHO0 = 1.225;

/** Mean motion of the Moon on a circular orbit, rad/s. */
export const MOON_RATE = Math.sqrt((MU_EARTH + MU_MOON) / MOON_DISTANCE ** 3);
/** Moon angle at mission time 0. Chosen so the Moon is above the horizon on launch day. */
export const MOON_ANGLE0 = 2.7;

/** Sun direction in ECI (fixed over a mission of a few days). */
export const SUN_DIR: Vec3 = vnorm({ x: 0.62, y: 0.55, z: 0.56 });

/* --------------------------------------------------------------- bodies */

export function moonPosition(t: number): Vec3 {
  const a = MOON_ANGLE0 + MOON_RATE * t;
  return { x: MOON_DISTANCE * Math.cos(a), y: MOON_DISTANCE * Math.sin(a), z: 0 };
}

export function moonVelocity(t: number): Vec3 {
  const a = MOON_ANGLE0 + MOON_RATE * t;
  const v = MOON_DISTANCE * MOON_RATE;
  return { x: -v * Math.sin(a), y: v * Math.cos(a), z: 0 };
}

/** Earth rotation angle at time t (radians); t = 0 is the start of the countdown. */
export const earthAngle = (t: number) => EARTH_ROTATION * t;

/** Earth-fixed (ECEF) -> inertial (ECI). The Earth turns about -Z. */
export function ecefToEci(p: Vec3, t: number): Vec3 {
  const a = -earthAngle(t);
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: c * p.x - s * p.y, y: s * p.x + c * p.y, z: p.z };
}

export function eciToEcef(p: Vec3, t: number): Vec3 {
  const a = earthAngle(t);
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: c * p.x - s * p.y, y: s * p.x + c * p.y, z: p.z };
}

/** Velocity of the air (co-rotating with the Earth) at an inertial position. */
export function airVelocity(p: Vec3): Vec3 {
  // Omega = (0, 0, -w); v = Omega x r
  return { x: EARTH_ROTATION * p.y, y: -EARTH_ROTATION * p.x, z: 0 };
}

/* ----------------------------------------------------------- atmosphere */

export function airDensity(altitude: number): number {
  if (altitude > ATMOSPHERE_TOP) return 0;
  return RHO0 * Math.exp(-Math.max(altitude, 0) / SCALE_HEIGHT);
}

/** Pressure relative to sea level, 0..1, used to blend sea-level and vacuum engine figures. */
export function pressureRatio(altitude: number): number {
  return Math.exp(-Math.max(altitude, 0) / SCALE_HEIGHT);
}

/* -------------------------------------------------------------- gravity */

/** Gravitational acceleration from the Earth and the Moon at position p, time t. */
export function gravity(p: Vec3, t: number): Vec3 {
  const r2 = p.x * p.x + p.y * p.y + p.z * p.z;
  const r = Math.sqrt(r2);
  const ge = -MU_EARTH / (r2 * r);
  const m = moonPosition(t);
  const dx = p.x - m.x;
  const dy = p.y - m.y;
  const dz = p.z - m.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  const d = Math.sqrt(d2);
  const gm = -MU_MOON / (d2 * d);
  // The Earth itself is pulled by the Moon too; subtract that so the frame stays Earth-centred.
  const mr2 = m.x * m.x + m.y * m.y;
  const mr = Math.sqrt(mr2);
  const gi = MU_MOON / (mr2 * mr);
  return {
    x: ge * p.x + gm * dx - gi * m.x,
    y: ge * p.y + gm * dy - gi * m.y,
    z: ge * p.z + gm * dz,
  };
}

/* ------------------------------------------------------- orbit elements */

export interface OrbitInfo {
  /** Periapsis and apoapsis altitude above the surface (m). Apoapsis is Infinity on escape. */
  periapsisAlt: number;
  apoapsisAlt: number;
  eccentricity: number;
  semiMajorAxis: number;
  /** Orbital period (s), Infinity if not bound. */
  period: number;
  /** Seconds until the next apoapsis (Infinity if none). */
  timeToApoapsis: number;
  timeToPeriapsis: number;
}

/** Two-body orbit around a body of gravitational parameter mu and radius R, from a relative state. */
export function orbitInfo(r: Vec3, v: Vec3, mu = MU_EARTH, bodyRadius = R_EARTH): OrbitInfo {
  const rl = vlen(r);
  const vl2 = vdot(v, v);
  const energy = vl2 / 2 - mu / rl;
  const h = vcross(r, v);
  const evec = vsub(vscale(vcross(v, h), 1 / mu), vscale(r, 1 / rl));
  const e = vlen(evec);
  const a = -mu / (2 * energy);
  const hl = vlen(h);
  const rp = (hl * hl) / mu / (1 + e);
  const bound = energy < 0 && e < 1;
  const ra = bound ? a * (1 + e) : Infinity;
  const period = bound ? 2 * Math.PI * Math.sqrt(a ** 3 / mu) : Infinity;

  let tToAp = Infinity;
  let tToPe = Infinity;
  if (bound && e > 1e-6) {
    // True anomaly -> eccentric anomaly -> mean anomaly.
    const cosNu = Math.min(1, Math.max(-1, vdot(evec, r) / (e * rl)));
    let nu = Math.acos(cosNu);
    if (vdot(r, v) < 0) nu = 2 * Math.PI - nu;
    const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2));
    let M = E - e * Math.sin(E);
    if (M < 0) M += 2 * Math.PI;
    const n = (2 * Math.PI) / period;
    tToPe = ((2 * Math.PI - M) % (2 * Math.PI)) / n;
    tToAp = (((Math.PI - M) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / n;
  }
  return {
    periapsisAlt: rp - bodyRadius,
    apoapsisAlt: ra - bodyRadius,
    eccentricity: e,
    semiMajorAxis: a,
    period,
    timeToApoapsis: tToAp,
    timeToPeriapsis: tToPe,
  };
}

/* ----------------------------------------------------------- propagator */

export interface CoastState {
  t: number;
  r: Vec3;
  v: Vec3;
}

export interface PropagateResult {
  end: CoastState;
  /** Closest approach to the Moon centre and when. */
  minMoonDist: number;
  minMoonTime: number;
  /** Lowest altitude above the Earth reached after leaving the start, and when. */
  minEarthAlt: number;
  minEarthTime: number;
  /** True if the path hits the Earth's atmosphere (alt < stopAlt) or the Moon's surface. */
  hitEarth: boolean;
  hitMoon: boolean;
  points?: Vec3[];
}

/** Suitable step for coasting: small near a body, large far away. */
export function coastStep(r: Vec3, v: Vec3, t: number, maxStep = 600): number {
  const re = vlen(r);
  const m = moonPosition(t);
  const rm = Math.hypot(r.x - m.x, r.y - m.y, r.z - m.z);
  const speed = vlen(v) + 1;
  // About 300 steps per orbit round the Earth, finer near the Moon where small errors
  // grow a lot during the swing-by.
  const dist = Math.min(re, rm * 0.5);
  return Math.max(0.5, Math.min(maxStep, (0.02 * dist) / speed));
}

function rk4(s: CoastState, dt: number): CoastState {
  const { r, v, t } = s;
  const a1 = gravity(r, t);
  const r2 = { x: r.x + v.x * dt * 0.5, y: r.y + v.y * dt * 0.5, z: r.z + v.z * dt * 0.5 };
  const v2 = { x: v.x + a1.x * dt * 0.5, y: v.y + a1.y * dt * 0.5, z: v.z + a1.z * dt * 0.5 };
  const a2 = gravity(r2, t + dt * 0.5);
  const r3 = { x: r.x + v2.x * dt * 0.5, y: r.y + v2.y * dt * 0.5, z: r.z + v2.z * dt * 0.5 };
  const v3_ = { x: v.x + a2.x * dt * 0.5, y: v.y + a2.y * dt * 0.5, z: v.z + a2.z * dt * 0.5 };
  const a3 = gravity(r3, t + dt * 0.5);
  const r4 = { x: r.x + v3_.x * dt, y: r.y + v3_.y * dt, z: r.z + v3_.z * dt };
  const v4 = { x: v.x + a3.x * dt, y: v.y + a3.y * dt, z: v.z + a3.z * dt };
  const a4 = gravity(r4, t + dt);
  return {
    t: t + dt,
    r: {
      x: r.x + (dt / 6) * (v.x + 2 * v2.x + 2 * v3_.x + v4.x),
      y: r.y + (dt / 6) * (v.y + 2 * v2.y + 2 * v3_.y + v4.y),
      z: r.z + (dt / 6) * (v.z + 2 * v2.z + 2 * v3_.z + v4.z),
    },
    v: {
      x: v.x + (dt / 6) * (a1.x + 2 * a2.x + 2 * a3.x + a4.x),
      y: v.y + (dt / 6) * (a1.y + 2 * a2.y + 2 * a3.y + a4.y),
      z: v.z + (dt / 6) * (a1.z + 2 * a2.z + 2 * a3.z + a4.z),
    },
  };
}

/** One RK4 coast step under Earth + Moon gravity (no drag). */
export const coastRk4 = rk4;

/**
 * Coasts a state forward under Earth and Moon gravity, tracking close approaches.
 * Stops early on hitting the atmosphere (stopAlt) or the Moon.
 */
export function propagate(
  start: CoastState,
  duration: number,
  opts: { stopAlt?: number; samplePoints?: number; maxStep?: number } = {},
): PropagateResult {
  const stopAlt = opts.stopAlt ?? 120000;
  let s: CoastState = { t: start.t, r: vcopy(start.r), v: vcopy(start.v) };
  const tEnd = start.t + duration;
  let minMoonDist = Infinity;
  let minMoonTime = start.t;
  let minEarthAlt = Infinity;
  let minEarthTime = start.t;
  let hitEarth = false;
  let hitMoon = false;
  const points: Vec3[] | undefined = opts.samplePoints ? [vcopy(s.r)] : undefined;
  const sampleEvery = opts.samplePoints ? duration / opts.samplePoints : Infinity;
  let nextSample = start.t + sampleEvery;
  let leftStart = false;
  const startAlt = vlen(start.r) - R_EARTH;

  while (s.t < tEnd) {
    const dt = Math.min(coastStep(s.r, s.v, s.t, opts.maxStep), tEnd - s.t);
    s = rk4(s, dt);
    const alt = vlen(s.r) - R_EARTH;
    const m = moonPosition(s.t);
    const dm = Math.hypot(s.r.x - m.x, s.r.y - m.y, s.r.z - m.z);
    if (dm < minMoonDist) {
      minMoonDist = dm;
      minMoonTime = s.t;
    }
    if (!leftStart && alt > startAlt + 20000) leftStart = true;
    if (leftStart && alt < minEarthAlt) {
      minEarthAlt = alt;
      minEarthTime = s.t;
    }
    if (points && s.t >= nextSample) {
      points.push(vcopy(s.r));
      nextSample += sampleEvery;
    }
    if (alt < stopAlt && leftStart) {
      hitEarth = true;
      break;
    }
    if (dm < R_MOON) {
      hitMoon = true;
      break;
    }
  }
  if (points) points.push(vcopy(s.r));
  return { end: s, minMoonDist, minMoonTime, minEarthAlt, minEarthTime, hitEarth, hitMoon, points };
}
