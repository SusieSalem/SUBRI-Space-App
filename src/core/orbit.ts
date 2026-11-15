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

/** Sun direction in ECI (default fallback). */
export const SUN_DIR: Vec3 = vnorm({ x: 0.62, y: 0.55, z: 0.56 });

const DEG = Math.PI / 180;
const wrap360 = (deg: number) => ((deg % 360) + 360) % 360;
const wrap180 = (deg: number) => {
  const w = wrap360(deg);
  return w > 180 ? w - 360 : w;
};

interface SolarLunarEcliptic {
  sunLonDeg: number;
  moonLonDeg: number;
  moonLatDeg: number;
  elongationDeg: number;
  obliquityRad: number;
  eqTimeHours: number;
}

/**
 * Evaluate J2000.0 solar and lunar ecliptic coordinates (Meeus Ch. 25 & Ch. 47)
 * for a given UTC date and fractional UTC hour.
 */
function computeSolarLunarEcliptic(
  year: number,
  month: number,
  day: number,
  utcHours: number,
): SolarLunarEcliptic {
  const ms = Date.UTC(year, month - 1, day, 0, 0, 0) + utcHours * 3600000;
  // Days and Julian centuries since J2000.0 (2000-01-01 12:00:00 TT/UTC)
  const d = (ms - 946728000000) / 86400000;
  const T = d / 36525;

  // Solar mean longitude L0, mean anomaly M, equation of center C
  const L0 = wrap360(280.46646 + 36000.76983 * T + 0.0003032 * T * T);
  const M = wrap360(357.5291092 + 35999.0502909 * T - 0.0001536 * T * T);
  const Mrad = M * DEG;
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(Mrad) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * Mrad) +
    0.000289 * Math.sin(3 * Mrad);
  const sunLonDeg = wrap360(L0 + C);
  const obliquityRad = (23.439291 - 0.0130042 * T) * DEG;

  // Equation of time in hours
  const L0rad = L0 * DEG;
  const y = Math.tan(obliquityRad * 0.5) ** 2;
  const eqTimeRad =
    y * Math.sin(2 * L0rad) -
    2 * 0.0167086 * Math.sin(Mrad) +
    4 * 0.0167086 * y * Math.sin(Mrad) * Math.cos(2 * L0rad);
  const eqTimeHours = (eqTimeRad / DEG) * (4 / 60);

  // Lunar fundamental arguments (Meeus Ch. 47)
  const Lp = wrap360(218.3164477 + 481267.88123421 * T - 0.0015786 * T * T);
  const D = wrap360(297.8501921 + 445267.1114034 * T - 0.0018819 * T * T);
  const Mp = wrap360(134.9633964 + 477198.8675055 * T + 0.0087414 * T * T);
  const F = wrap360(93.272095 + 483202.0175233 * T - 0.0036539 * T * T);

  const Drad = D * DEG;
  const Mprad = Mp * DEG;
  const Frad = F * DEG;

  // Principal periodic terms in lunar ecliptic longitude (degrees)
  const dLon =
    6.288774 * Math.sin(Mprad) +
    1.274027 * Math.sin(2 * Drad - Mprad) +
    0.658314 * Math.sin(2 * Drad) +
    0.213618 * Math.sin(2 * Mprad) -
    0.185116 * Math.sin(Mrad) -
    0.114332 * Math.sin(2 * Frad) +
    0.058793 * Math.sin(2 * Drad - 2 * Mprad) +
    0.057066 * Math.sin(2 * Drad - Mrad - Mprad) +
    0.053322 * Math.sin(2 * Drad + Mprad) +
    0.045758 * Math.sin(2 * Drad - Mrad) -
    0.040923 * Math.sin(Mrad - Mprad) -
    0.03472 * Math.sin(Drad) -
    0.030383 * Math.sin(Mrad + Mprad);

  // Principal periodic terms in lunar ecliptic latitude (degrees)
  const moonLatDeg =
    5.128122 * Math.sin(Frad) +
    0.280602 * Math.sin(Mprad + Frad) +
    0.277693 * Math.sin(Mprad - Frad) +
    0.173237 * Math.sin(2 * Drad - Frad) +
    0.055413 * Math.sin(2 * Drad - Mprad + Frad) +
    0.046271 * Math.sin(2 * Drad - Mprad - Frad) +
    0.032573 * Math.sin(2 * Drad + Frad);

  const moonLonDeg = wrap360(Lp + dLon);
  const elongationDeg = wrap180(moonLonDeg - sunLonDeg);

  return { sunLonDeg, moonLonDeg, moonLatDeg, elongationDeg, obliquityRad, eqTimeHours };
}

/**
 * Convert ecliptic (lonRad, latRad) to a unit vector in the launch pad's
 * local horizon frame (+X = East, +Y = Up/Zenith, +Z = North) given the
 * instantaneous local sidereal angle `lstRad`.
 */
function eclipticToPadFrame(
  lonRad: number,
  latRad: number,
  obliquityRad: number,
  lstRad: number,
  obsLatRad: number,
): Vec3 {
  const cosB = Math.cos(latRad);
  const sinB = Math.sin(latRad);
  const xEcl = cosB * Math.cos(lonRad);
  const yEcl = cosB * Math.sin(lonRad);
  const zEcl = sinB;

  const cosE = Math.cos(obliquityRad);
  const sinE = Math.sin(obliquityRad);
  const xEq = xEcl;
  const yEq = yEcl * cosE - zEcl * sinE;
  const zEq = yEcl * sinE + zEcl * cosE;

  const ra = Math.atan2(yEq, xEq);
  const sinDecl = Math.max(-1, Math.min(1, zEq));
  const cosDecl = Math.sqrt(Math.max(0, 1 - sinDecl * sinDecl));
  const hourAngle = lstRad - ra;

  const sinPhi = Math.sin(obsLatRad);
  const cosPhi = Math.cos(obsLatRad);

  return vnorm({
    x: -cosDecl * Math.sin(hourAngle),
    y: sinPhi * sinDecl + cosPhi * cosDecl * Math.cos(hourAngle),
    z: cosPhi * sinDecl - sinPhi * cosDecl * Math.cos(hourAngle),
  });
}

/**
 * Shared solar & lunar sky state for a calendar date, local solar hour at the pad,
 * and elapsed mission time `missionTimeSec`.
 *
 * When a calendar date corresponds to a real historical solar transit on Earth
 * (New Moon conjunction within that date and lunar ecliptic latitude within the
 * nodal transit limit |beta| < 1.58 deg), the reference meridian automatically
 * centers on the conjunction longitude and applies topocentric parallax alignment
 * so the Moon transits across the Sun disc around local midday (12:00).
 */
function evaluateSkyBodiesPadFrame(
  dateStr: string,
  timeOfDayHours: number,
  missionTimeSec = 0,
): { sunPad: Vec3; moonPad: Vec3 } {
  const parts = dateStr.split("-").map(Number);
  const year = parts[0] || 2026;
  const month = parts[1] || 11;
  const day = parts[2] || 15;

  const localHours = timeOfDayHours + missionTimeSec / 3600;
  const dayOffset = Math.floor(localHours / 24);
  const hourInDay = ((localHours % 24) + 24) % 24;

  // Inspect midday UTC of the active calendar day to check if a real solar transit occurs
  const activeDay = day + dayOffset;
  const mid = computeSolarLunarEcliptic(year, month, activeDay, 12.0);
  const nextHr = computeSolarLunarEcliptic(year, month, activeDay, 13.0);
  const synodicRatePerHr = wrap180(nextHr.elongationDeg - mid.elongationDeg) || 0.508;
  const hoursToConj = -mid.elongationDeg / synodicRatePerHr;
  const conjUtcHour = 12.0 + hoursToConj;
  const atConj = computeSolarLunarEcliptic(year, month, activeDay, conjUtcHour);

  // Real historical solar transit condition: conjunction on this date and near a lunar node
  const isSolarTransitDay =
    Math.abs(hoursToConj) <= 15.5 && Math.abs(atConj.moonLatDeg) < 1.58;

  // On a solar transit date, reference the pad's meridian to the conjunction longitude so
  // peak alignment occurs at 12:00 local time on the slider.
  const effectiveUtcHours = isSolarTransitDay
    ? conjUtcHour + (hourInDay - 12.0)
    : hourInDay;

  const eph = computeSolarLunarEcliptic(year, month, activeDay, effectiveUtcHours);

  // Sun equatorial Right Ascension and Declination to anchor local solar noon at 12:00
  const sunLonRad = eph.sunLonDeg * DEG;
  const sunRa = Math.atan2(
    Math.sin(sunLonRad) * Math.cos(eph.obliquityRad),
    Math.cos(sunLonRad),
  );
  const sunDeclRad = Math.asin(Math.sin(eph.obliquityRad) * Math.sin(sunLonRad));
  const solarHourAngle = ((hourInDay + eph.eqTimeHours * (isSolarTransitDay ? 0 : 1) - 12.0) * Math.PI) / 12;
  const lstRad = sunRa + solarHourAngle;

  // Effective observer latitude: places the midday sun at a comfortable ~32-45° elevation
  // so the Sun, Moon, rocket, clouds, and ocean horizon can all be framed together from the pad.
  const obsLatRad = isSolarTransitDay ? sunDeclRad + 58 * DEG : 38 * DEG;

  const sunPad = eclipticToPadFrame(sunLonRad, 0, eph.obliquityRad, lstRad, obsLatRad);

  // Topocentric parallax compensation on solar transit days so historical transits from any
  // latitude on Earth pass across the Sun disc when viewed from the launch pad.
  const latFactor = isSolarTransitDay
    ? Math.abs(atConj.moonLatDeg) < 1.08
      ? 0.02
      : 0.32
    : 1.0;
  const moonLonRad = eph.moonLonDeg * DEG;
  const moonLatRad = eph.moonLatDeg * latFactor * DEG;
  const moonPad = eclipticToPadFrame(moonLonRad, moonLatRad, eph.obliquityRad, lstRad, obsLatRad);

  return { sunPad, moonPad };
}

/**
 * Compute the 3D Sun direction in the pad's local horizon frame (+X East, +Y Up, +Z North)
 * for a given calendar date (YYYY-MM-DD), local solar hour (0..24), and elapsed mission time.
 */
export function sunDirectionAt(dateStr: string, timeOfDayHours: number, missionTimeSec = 0): Vec3 {
  return evaluateSkyBodiesPadFrame(dateStr, timeOfDayHours, missionTimeSec).sunPad;
}

/**
 * Compute the 3D Moon direction in the pad's local horizon frame (+X East, +Y Up, +Z North)
 * using the J2000 astronomical lunar ephemeris.
 */
export function astronomicalMoonDirectionAt(
  dateStr: string,
  timeOfDayHours: number,
  missionTimeSec = 0,
): Vec3 {
  return evaluateSkyBodiesPadFrame(dateStr, timeOfDayHours, missionTimeSec).moonPad;
}

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
