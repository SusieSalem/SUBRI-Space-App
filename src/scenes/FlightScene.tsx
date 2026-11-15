// One continuous world from the launch pad to the Moon and back.
//
// The physics runs in Earth-centred inertial coordinates (src/core). To draw it
// at real scale without precision problems the world is re-centred on the
// spacecraft every frame (floating origin) and turned so the local "up" at the
// spacecraft is +Y. The camera orbits the spacecraft and never switches scenes:
// the pad drops away below, the sky darkens, the Earth curves, all because the
// rocket is really climbing in the simulation.

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { PartId } from "../core/design";
import type { RocketId } from "../core/launchCheck";
import {
  R_EARTH,
  SUN_DIR,
  airDensity,
  astronomicalMoonDirectionAt,
  earthAngle,
  ecefToEci,
  eciToEcef,
  gravity,
  moonPosition,
  pressureRatio,
  sunDirectionAt,
  type Vec3,
} from "../core/orbit";
import { artemisPath } from "../core/artemis2";
import { COUNTDOWN_S, FlightSim, MOUNT_HEIGHT, PAD_ECEF, PHASE_LABEL, type PieceId as SimPieceId } from "../core/simulate";
import {
  playAlert,
  playCountdownBeep,
  playLaunchRumbling,
  playMissionResult,
  playPartSnap,
} from "../audio/soundManager";
import Astronaut from "./Astronaut";
import LaunchSite from "./LaunchSite";
import Rocket, { stackDims, type PieceId, type RocketHandle } from "./Rocket";
import ShaderMat from "./ShaderMat";
import Spacecraft from "./Spacecraft";
import { useSmoke } from "./Smoke";
import { planetFragment, planetVertex } from "./shaders/planet";

export type Quality = "high" | "low";

export interface WarpControl {
  /** Requested warp, or "auto" to let the game pick. */
  setting: number | "auto";
  paused: boolean;
}

export interface Telemetry {
  phase: string;
  message: string;
  t: number;
  altitude: number;
  verticalSpeed: number;
  orbitalSpeed: number;
  surfaceSpeed: number;
  apoapsis: number;
  periapsis: number;
  fuelName: string;
  fuel: number;
  throttle: number;
  warp: number;
  maxWarp: number;
  moonDistance: number;
  autopilot: boolean;
  maxG: number;
  /** Lowest height above the Moon so far (m) and when (sim s). */
  closestMoon: number;
  closestMoonT: number;
  /** Highest altitude above the Earth so far (m) and when (sim s). */
  maxAltitude: number;
  maxAltitudeT: number;
  /** Entry interface (sim s), or Infinity. */
  entryT: number;
  done: boolean;
  failed: boolean;
}

interface Props {
  /** Bumped whenever simRef points at a new vehicle. */
  version: number;
  simRef: React.MutableRefObject<FlightSim>;
  rocket: RocketId;
  parts: PartId[];
  flying: boolean;
  warp: React.MutableRefObject<WarpControl>;
  keys: React.MutableRefObject<Set<string>>;
  mapView: boolean;
  quality: Quality;
  launchDate: string;
  timeOfDay: number;
  syncCycle: boolean;
  /** Ask the camera to line up so this body is behind the spacecraft. `n` changes on each request. */
  lookAt: { body: "earth" | "moon"; n: number } | null;
  onTelemetry: (t: Telemetry) => void;
}

const SUN_INTENSITY = 15;
const ECI_Z = new THREE.Vector3(0, 0, 1);

/* -------------------------------------------------------------- helpers */

/** ECI -> world rotation for a spacecraft at ECI position r (local up becomes +Y). */
function frameQuaternion(r: Vec3, out: THREE.Quaternion) {
  const up = new THREE.Vector3(r.x, r.y, r.z).normalize();
  const east = new THREE.Vector3().crossVectors(up, ECI_Z);
  if (east.lengthSq() < 1e-8) east.set(1, 0, 0);
  east.normalize();
  const z = new THREE.Vector3().crossVectors(east, up).normalize();
  const m = new THREE.Matrix4().makeBasis(east, up, z); // world -> ECI
  return out.setFromRotationMatrix(m).invert();
}

/** Rocket body frame (+Y along the nose) expressed in ECI. */
function attitudeQuaternion(att: Vec3, out: THREE.Quaternion) {
  const y = new THREE.Vector3(att.x, att.y, att.z).normalize();
  let x = new THREE.Vector3().crossVectors(y, ECI_Z);
  if (x.lengthSq() < 1e-8) x = new THREE.Vector3(1, 0, 0);
  x.normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

const sub = (a: Vec3, b: Vec3) => new THREE.Vector3(a.x - b.x, a.y - b.y, a.z - b.z);

function autoWarp(sim: FlightSim): number {
  const max = sim.maxWarp;
  if (sim.phase === "parachutes") return Math.min(max, 20);
  if (sim.phase === "entry") return Math.min(max, 3);
  // Powered flight: real time down low, 4x once above most of the air.
  if (max <= 4) return sim.altitude > 20000 || sim.phase === "tli" ? 4 : 1;
  const tn = sim.timeToNextEvent;
  if (!isFinite(tn)) return Math.min(max, 1000);
  return Math.max(1, Math.min(max, tn / 5));
}

/* ------------------------------------------------------------- the world */

interface Debris {
  r: Vec3;
  v: Vec3;
  q: THREE.Quaternion;
  t0: number;
  spin: THREE.Vector3;
  gone: boolean;
}

function World({ version, simRef, rocket, parts, flying, warp, keys, mapView, quality, launchDate, timeOfDay, syncCycle, lookAt, onTelemetry }: Props) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as OrbitControlsImpl | null;
  const rocketRef = useRef<RocketHandle>(null);
  const siteRef = useRef<THREE.Group>(null);
  const smDebrisRef = useRef<THREE.Group>(null);
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const padLightRef = useRef<THREE.PointLight>(null);
  const skyRef = useRef<THREE.Mesh>(null);
  const linesRef = useRef<THREE.Group>(null);
  const [smokePoints, smoke] = useSmoke();
  const debris = useRef<Partial<Record<PieceId | "serviceModule", Debris>>>({});
  const eventIndex = useRef(0);
  const sounds = useRef(new Set<string>());
  const stopRumble = useRef<(() => void) | null>(null);
  const lastReport = useRef(0);
  const lastPredict = useRef(0);
  const prevTarget = useRef(new THREE.Vector3());
  const anchor = useRef<Vec3>({ x: 0, y: 0, z: 0 });
  const lookPending = useRef<"earth" | "moon" | null>(null);
  const autoFramed = useRef(new Set<string>());
  const [flags, setFlags] = useState({ deployed: false, capsuleOnly: false, serviceBurning: false, heat: 0 });
  const dims = stackDims(rocket, parts);
  const armSwing = useArmSwing(simRef, flying);

  const skyUniforms = useMemo(() => {
    const loader = new THREE.TextureLoader();
    const loadGlobeTex = (url: string) => {
      const tex = loader.load(url);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      // Mipmaps so the globe doesn't shimmer from orbit; anisotropy keeps it sharp at grazing angles.
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      tex.anisotropy = 8;
      return tex;
    };
    return {
      uWorldToEci: { value: new THREE.Matrix3() },
      uSunDir: { value: new THREE.Vector3(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z) },
      uCamUp: { value: new THREE.Vector3(0, 1, 0) },
      uCamAlt: { value: 10 },
      uCamFromPad: { value: new THREE.Vector3() },
      uPadEast: { value: new THREE.Vector3(1, 0, 0) },
      uPadNorth: { value: new THREE.Vector3(0, 0, 1) },
      uMoonRel: { value: new THREE.Vector3() },
      uEarthAngle: { value: 0 },
      uTime: { value: 0 },
      uRealTime: { value: 0 },
      uSunIntensity: { value: SUN_INTENSITY },
      uEarthDay: { value: loadGlobeTex("/textures/earth_day.jpg") },
      uEarthNight: { value: loadGlobeTex("/textures/earth_night.png") },
      uEarthSpec: { value: loadGlobeTex("/textures/earth_specular.jpg") },
    };
  }, []);
  const skyDefines = useMemo(
    () =>
      quality === "high"
        ? { VIEW_STEPS: 6, LIGHT_STEPS: 2, CLOUD_STEPS: 8, CLOUD_LIGHT: 2, WATER_OCTAVES: 3, WATER_HQ: 1 }
        : { VIEW_STEPS: 4, LIGHT_STEPS: 1, CLOUD_STEPS: 3, CLOUD_LIGHT: 0, WATER_OCTAVES: 2, WATER_HQ: 0 },
    [quality],
  );

  // Predicted path and the Moon's orbit, drawn in ECI relative to an anchor point.
  const pathLine = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * 600), 3));
    g.setDrawRange(0, 0);
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: "#5fa8ff", transparent: true, opacity: 0.85 }));
    line.frustumCulled = false;
    return line;
  }, []);
  const moonLine = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * 257), 3));
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: "#8b96a8", transparent: true, opacity: 0.5 }));
    line.frustumCulled = false;
    return line;
  }, []);

  // NASA's real Artemis II path on the same mission clock as the player (src/core/artemis2.ts).
  const artemis = useMemo(() => {
    const pts = artemisPath(COUNTDOWN_S);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * pts.length), 3));
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: "#ffb347", transparent: true, opacity: 0.7 }));
    line.frustumCulled = false;
    return { line, pts };
  }, []);

  // New flight: reset debris, events, camera.
  useEffect(() => {
    debris.current = {};
    eventIndex.current = 0;
    sounds.current.clear();
    setFlags({ deployed: false, capsuleOnly: false, serviceBurning: false, heat: 0 });
    if (smDebrisRef.current) smDebrisRef.current.visible = false;
    if (controls) {
      controls.target.set(0, dims.total * 0.45, 0);
      prevTarget.current.copy(controls.target);
      if (!flying) camera.position.set(dims.total * 0.9, dims.total * 0.35, dims.total * 1.3);
      controls.update();
    }
    return () => {
      stopRumble.current?.();
      stopRumble.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, controls]);

  useEffect(() => {
    if (lookAt) lookPending.current = lookAt.body;
  }, [lookAt]);

  // Map view: pull the camera far out (or back in) along its current direction.
  useEffect(() => {
    if (!controls) return;
    const sim = simRef.current;
    const dir = camera.position.clone().sub(controls.target).normalize();
    const dist = mapView ? Math.max(4e7, (sim.altitude + R_EARTH) * 3.2) : Math.max(60, dims.total * 1.6);
    camera.position.copy(controls.target).addScaledVector(dir, dist);
    controls.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapView, controls]);

  useFrame((state, dtRaw) => {
    const sim = simRef.current;
    const handle = rocketRef.current;
    const realDt = Math.min(dtRaw, 0.1);

    // Manual control from the keyboard (only when the autopilot is off).
    const k = keys.current;
    if (!sim.autopilot) {
      const th = sim.manual.throttle + ((k.has("shift") ? 1 : 0) - (k.has("control") ? 1 : 0)) * realDt * 0.8;
      sim.setManual({
        pitch: (k.has("w") ? 1 : 0) - (k.has("s") ? 1 : 0),
        yaw: (k.has("d") ? 1 : 0) - (k.has("a") ? 1 : 0),
        throttle: k.has("z") ? 1 : k.has("x") ? 0 : Math.max(0, Math.min(1, th)),
      });
    }

    // Advance the physics.
    const w = warp.current;
    let warpNow = 0;
    if (flying && !w.paused) {
      warpNow = w.setting === "auto" ? autoWarp(sim) : Math.min(w.setting, sim.maxWarp);
      sim.advance(realDt * warpNow);
      smoke.time.value += realDt * warpNow;
    }
    const t = sim.t;

    // Sounds: countdown beeps, engine rumble, and mission outcome.
    if (flying) {
      for (let s = 5; s >= 0; s--) {
        const key = `beep${s}`;
        if (t >= COUNTDOWN_S - s && !sounds.current.has(key)) {
          sounds.current.add(key);
          playCountdownBeep(s === 0);
        }
      }
      if (t >= COUNTDOWN_S - 3 && !sounds.current.has("rumble")) {
        sounds.current.add("rumble");
        stopRumble.current = playLaunchRumbling(20);
      }
      if (sim.phase === "splashdown" && !sounds.current.has("missionDone")) {
        sounds.current.add("missionDone");
        stopRumble.current?.();
        playMissionResult(true, 3);
      }
      if (sim.phase === "failed" && !sounds.current.has("missionFailed")) {
        sounds.current.add("missionFailed");
        stopRumble.current?.();
        playAlert("failure");
        playMissionResult(false, 1);
      }
    }

    // Frame: ECI -> world, re-centred on the spacecraft.
    const qFrame = frameQuaternion(sim.r, new THREE.Quaternion());
    const toWorld = (v: THREE.Vector3) => v.applyQuaternion(qFrame);
    const qAtt = attitudeQuaternion(sim.attitude, new THREE.Quaternion());
    const qBody = qFrame.clone().multiply(qAtt);

    // New separation events become falling debris.
    while (eventIndex.current < sim.events.length) {
      const e = sim.events[eventIndex.current++];
      if (e.type !== "separation" || !e.piece) continue;
      playPartSnap(false);
      const piece = mapPiece(e.piece);
      const v = { ...e.v };
      if (e.piece === "escapeTower") {
        v.x += e.attitude.x * 120;
        v.y += e.attitude.y * 120;
        v.z += e.attitude.z * 120;
      } else {
        v.x -= e.attitude.x * 3;
        v.y -= e.attitude.y * 3;
        v.z -= e.attitude.z * 3;
      }
      debris.current[piece] = {
        r: { ...e.r },
        v,
        q: attitudeQuaternion(e.attitude, new THREE.Quaternion()),
        t0: e.t,
        spin: new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.2, Math.random() - 0.5).normalize(),
        gone: false,
      };
      if (piece === "serviceModule" && smDebrisRef.current) smDebrisRef.current.visible = true;
    }

    // Debris physics: gravity and drag, until it hits the ground or drifts far away.
    for (const [id, d] of Object.entries(debris.current) as [string, Debris][]) {
      if (d.gone) continue;
      let simDt = realDt * Math.max(warpNow, 0);
      let guard = 0;
      while (simDt > 0 && guard++ < 400) {
        const h = Math.min(0.05 * Math.max(1, warpNow / 4), simDt);
        const g = gravity(d.r, t);
        const alt = Math.hypot(d.r.x, d.r.y, d.r.z) - R_EARTH;
        const rho = airDensity(alt);
        const sp = Math.hypot(d.v.x, d.v.y, d.v.z);
        const k2 = rho * sp * 0.002;
        d.v.x += (g.x - d.v.x * k2) * h;
        d.v.y += (g.y - d.v.y * k2) * h;
        d.v.z += (g.z - d.v.z * k2) * h;
        d.r.x += d.v.x * h;
        d.r.y += d.v.y * h;
        d.r.z += d.v.z * h;
        simDt -= h;
        if (alt < 0) {
          d.gone = true;
          break;
        }
      }
      if (t - d.t0 > 1800) d.gone = true;
      const grp = id === "serviceModule" ? smDebrisRef.current : handle?.pieces[id as PieceId];
      if (!grp) continue;
      grp.visible = !d.gone;
      const rel = toWorld(sub(d.r, sim.r));
      grp.position.copy(rel);
      const spinQ = new THREE.Quaternion().setFromAxisAngle(d.spin, (t - d.t0) * 0.25);
      grp.quaternion.copy(qFrame).multiply(d.q).multiply(spinQ);
    }

    // Attached pieces ride with the spacecraft at the origin.
    if (handle) {
      const att = sim.attached;
      const attachedMap: Record<PieceId, boolean> = {
        boosters: att.boosters,
        stage1: att.stage1,
        stage2: att.stage2,
        escapeTower: att.escapeTower,
        spacecraft: true,
      };
      for (const id of Object.keys(attachedMap) as PieceId[]) {
        const g = handle.pieces[id];
        if (!g || !attachedMap[id]) continue;
        g.visible = true;
        g.position.set(0, 0, 0);
        g.quaternion.copy(qBody);
      }

      // Exhaust: one plume per stage, longer and wider as the air thins.
      const p = handle.plumes;
      const time = state.clock.elapsedTime;
      const throttle = sim.throttle;
      for (const [u, on] of [
        [p.boosters, sim.burning.boosters],
        [p.stage1, sim.burning.stage1],
        [p.stage2, sim.burning.stage2],
      ] as const) {
        u.uTime.value = time;
        const target = on ? throttle : 0;
        u.uThrottle.value += (target - u.uThrottle.value) * Math.min(1, realDt * 10);
      }
      handle.setPlumeLength(1 + 3 * (1 - pressureRatio(sim.altitude)));
    }

    // Spacecraft state flags (rare changes -> React state).
    const nf = {
      deployed: !sim.attached.stage2 && flying,
      capsuleOnly: !sim.attached.serviceModule && flying,
      serviceBurning: sim.burning.service,
      heat: Math.round(sim.heat * 20) / 20,
    };
    if (
      nf.deployed !== flags.deployed ||
      nf.capsuleOnly !== flags.capsuleOnly ||
      nf.serviceBurning !== flags.serviceBurning ||
      nf.heat !== flags.heat
    )
      setFlags(nf);

    // Launch site: fixed to the turning Earth.
    const padEci = ecefToEci(PAD_ECEF, t);
    if (siteRef.current) {
      const rel = sub(padEci, sim.r);
      siteRef.current.visible = rel.length() < 400000;
      siteRef.current.position.copy(toWorld(rel));
      const qEarth = new THREE.Quaternion().setFromAxisAngle(ECI_Z, -earthAngle(t));
      siteRef.current.quaternion.copy(qFrame).multiply(qEarth);
    }

    // Smoke from the pad and a trail behind the rocket in the lower atmosphere.
    if (flying && sim.throttle > 0.05 && (sim.burning.stage1 || sim.burning.boosters) && sim.altitude < 30000 && warpNow > 0) {
      const nozzleOffset = handle ? handle.nozzleY.stage1 : -2;
      const nozzleEci = {
        x: sim.r.x + sim.attitude.x * nozzleOffset,
        y: sim.r.y + sim.attitude.y * nozzleOffset,
        z: sim.r.z + sim.attitude.z * nozzleOffset,
      };
      const local = eciToEcef(nozzleEci, t);
      const pl = new THREE.Vector3(local.x - PAD_ECEF.x, local.y - PAD_ECEF.y, local.z - PAD_ECEF.z);
      const n = Math.min(quality === "high" ? 6 : 2, Math.ceil(realDt * warpNow * (quality === "high" ? 60 : 20)));
      for (let i = 0; i < n; i++) {
        if (sim.altitude < 300) {
          const a = Math.random() * Math.PI * 2;
          const sp = 30 + Math.random() * 50;
          smoke.emit(
            new THREE.Vector3(Math.cos(a) * 8, 2 + Math.random() * 3, Math.sin(a) * 8),
            new THREE.Vector3(Math.cos(a) * sp, Math.random() * 6, Math.sin(a) * sp),
            9 + Math.random() * 6,
            26 + Math.random() * 20,
          );
        }
        const j = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(5);
        smoke.emit(pl.clone().add(j), j.clone().multiplyScalar(2), 14, 12 + sim.altitude / 350);
      }
    }

    // Solar & Lunar positions from calendar date (YYYY-MM-DD), time of day (hours), and elapsed mission time.
    // Both are computed in the pad's local horizon frame and rotated into ECI by ecefToEci(..., t) so
    // the sky always matches the Date and Time controls whether Cycle is on or Locked.
    const simTimeForSky = syncCycle ? t : 0;
    const sunDirPad = sunDirectionAt(launchDate, timeOfDay, simTimeForSky);
    const moonDirPad = astronomicalMoonDirectionAt(launchDate, timeOfDay, simTimeForSky);
    const sunDirEci = ecefToEci(sunDirPad, t);
    const moonDirEci = ecefToEci(moonDirPad, t);
    const sunVecEci = new THREE.Vector3(sunDirEci.x, sunDirEci.y, sunDirEci.z);

    // Compute lunar transit dimming factor for 3D scene lights (rocket & pad)
    const sepX = sunDirEci.x - moonDirEci.x;
    const sepY = sunDirEci.y - moonDirEci.y;
    const sepZ = sunDirEci.z - moonDirEci.z;
    const sunMoonSep = Math.hypot(sepX, sepY, sepZ);
    const transitLightFactor =
      0.03 + 0.97 * THREE.MathUtils.smoothstep(sunMoonSep, 0.0005, 0.0145);

    // Lights: the Sun, skylight fading with height, flame light on the pad.
    const sunWorld = toWorld(sunVecEci.clone());
    if (sunRef.current) {
      sunRef.current.position.copy(sunWorld).multiplyScalar(400);
      sunRef.current.target.position.set(0, 0, 0);
      sunRef.current.target.updateMatrixWorld();
      // The Earth's shadow + smooth twilight transition near horizon + lunar transit dimming.
      const r = new THREE.Vector3(sim.r.x, sim.r.y, sim.r.z);
      const along = r.dot(sunVecEci);
      const perp = Math.sqrt(Math.max(0, r.lengthSq() - along * along));
      const inShadow = along < 0 && perp < R_EARTH;
      const sunElevAtShip = r.clone().normalize().dot(sunVecEci);
      const dayFactor = THREE.MathUtils.smoothstep(sunElevAtShip, -0.08, 0.12);
      sunRef.current.intensity = inShadow ? 0 : 3.4 * Math.max(0.04, dayFactor) * transitLightFactor;
    }
    if (hemiRef.current) {
      const rNorm = new THREE.Vector3(sim.r.x, sim.r.y, sim.r.z).normalize();
      const dayHemi = THREE.MathUtils.smoothstep(rNorm.dot(sunVecEci), -0.15, 0.2);
      hemiRef.current.intensity =
        (0.03 + 0.55 * Math.exp(-Math.max(0, sim.altitude) / 15000)) *
        (0.12 + 0.88 * dayHemi) *
        (0.18 + 0.82 * transitLightFactor);
    }
    if (padLightRef.current) {
      const on = sim.burning.stage1 || sim.burning.boosters;
      padLightRef.current.intensity = on ? 3000 * sim.throttle * Math.max(0, 1 - sim.altitude / 800) * (0.85 + 0.3 * Math.random()) : 0;
    }

    // Camera follows the middle of whatever is still attached.
    if (controls) {
      const base = sim.attached.stage1 || sim.attached.boosters ? 0 : sim.attached.stage2 ? dims.stage2Base : dims.capsuleBase - 5;
      const top = dims.total;
      const centre = new THREE.Vector3(0, (base + top) / 2, 0).applyQuaternion(qBody);
      const delta = centre.clone().sub(prevTarget.current);
      camera.position.add(delta);
      controls.target.copy(centre);
      prevTarget.current.copy(centre);
      const camDistToTarget = Math.max(10, camera.position.distanceTo(centre));
      const groundCos = Math.max(-0.92, Math.min(0.03, (2.2 - centre.y) / camDistToTarget));
      controls.maxPolarAngle = flying && sim.altitude > 200 ? Math.PI : Math.acos(groundCos);

      // Frame the Moon on the way in and the Earth on the way home, once each.
      if (flying && sim.moonDistance < 80000000 && !autoFramed.current.has("moon")) {
        autoFramed.current.add("moon");
        lookPending.current = "moon";
      }
      if (flying && sim.phase === "return" && !autoFramed.current.has("earth")) {
        autoFramed.current.add("earth");
        lookPending.current = "earth";
      }
      if (lookPending.current) {
        const body = lookPending.current === "moon" ? moonPosition(t) : { x: 0, y: 0, z: 0 };
        // Camera on the far side of the ship from the body, a little above.
        const away = toWorld(sub(sim.r, body)).normalize();
        const dist = Math.max(40, camera.position.distanceTo(controls.target));
        const lift = new THREE.Vector3(0, 1, 0).sub(away.clone().multiplyScalar(away.y)).normalize();
        camera.position.copy(controls.target).addScaledVector(away, dist).addScaledVector(lift, dist * 0.18);
        controls.update();
        lookPending.current = null;
      }
    }

    // Sky / planet shader inputs, all relative to the camera in double precision.
    const camEciOffset = camera.position.clone().applyQuaternion(qFrame.clone().invert());
    const camEci = { x: sim.r.x + camEciOffset.x, y: sim.r.y + camEciOffset.y, z: sim.r.z + camEciOffset.z };
    const camR = Math.hypot(camEci.x, camEci.y, camEci.z);
    const u = skyUniforms;
    u.uWorldToEci.value.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(qFrame.clone().invert()));
    u.uSunDir.value.copy(sunVecEci);
    u.uCamAlt.value = camR - R_EARTH;
    u.uCamUp.value.set(camEci.x / camR, camEci.y / camR, camEci.z / camR);
    u.uCamFromPad.value.set(camEci.x - padEci.x, camEci.y - padEci.y, camEci.z - padEci.z);
    const east = ecefToEci({ x: 1, y: 0, z: 0 }, t);
    const north = ecefToEci({ x: 0, y: 0, z: 1 }, t);
    u.uPadEast.value.set(east.x, east.y, east.z);
    u.uPadNorth.value.set(north.x, north.y, north.z);

    // Near Earth (on the pad or during ascent), position the visual Moon using the J2000 astronomical
    // lunar ephemeris relative to the camera so historical solar transits and lunar phases align accurately;
    // in deep space flight, blend smoothly to the trajectory propagator's moonPosition(t).
    const astroDist = 234000000;
    const astroMoonRel = {
      x: moonDirEci.x * astroDist,
      y: moonDirEci.y * astroDist,
      z: moonDirEci.z * astroDist,
    };
    const orbitMoon = moonPosition(t);
    const orbitMoonRel = {
      x: orbitMoon.x - camEci.x,
      y: orbitMoon.y - camEci.y,
      z: orbitMoon.z - camEci.z,
    };
    const deepSpaceBlend = flying
      ? THREE.MathUtils.smoothstep(sim.altitude, 250000, 15000000)
      : 0;
    u.uMoonRel.value.set(
      astroMoonRel.x + (orbitMoonRel.x - astroMoonRel.x) * deepSpaceBlend,
      astroMoonRel.y + (orbitMoonRel.y - astroMoonRel.y) * deepSpaceBlend,
      astroMoonRel.z + (orbitMoonRel.z - astroMoonRel.z) * deepSpaceBlend,
    );
    u.uEarthAngle.value = earthAngle(t);
    // Cloud time combines real-time ambient drift (even on the pad), mission time (when syncCycle is on),
    // and time-of-day scrubbing so moving the slider forward/backward visibly moves the clouds!
    const cloudTime = (syncCycle ? t : 0) + state.clock.elapsedTime * 1.8 + (timeOfDay - 9.0) * 180.0;
    u.uTime.value = cloudTime;
    u.uRealTime.value = state.clock.elapsedTime + (timeOfDay - 9.0) * 12.0;
    skyRef.current?.position.copy(camera.position);

    // Predicted path (KSP-style orbit line), refreshed a couple of times a second.
    const camDist = camera.position.distanceTo(controls?.target ?? camera.position);
    const showLines = mapView || camDist > 30000;
    if (linesRef.current) linesRef.current.visible = showLines && flying;
    const now = performance.now();
    if (flying && showLines && now - lastPredict.current > 500 && !sim.onPad) {
      lastPredict.current = now;
      const orbit = sim.orbit();
      const horizon = isFinite(orbit.period) && orbit.apoapsisAlt < 1e8 ? orbit.period * 1.02 : 9 * 86400;
      const pts = sim.predict(Math.min(horizon, 9 * 86400), 590);
      anchor.current = { ...sim.r };
      const arr = pathLine.geometry.attributes.position.array as Float32Array;
      pts.forEach((p, i) => arr.set([p.x - anchor.current.x, p.y - anchor.current.y, p.z - anchor.current.z], i * 3));
      pathLine.geometry.setDrawRange(0, pts.length);
      pathLine.geometry.attributes.position.needsUpdate = true;
      pathLine.geometry.computeBoundingSphere();
      const marr = moonLine.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i <= 256; i++) {
        const mp = moonPosition(t + (i / 256) * 27.3 * 86400);
        marr.set([mp.x - anchor.current.x, mp.y - anchor.current.y, mp.z - anchor.current.z], i * 3);
      }
      moonLine.geometry.attributes.position.needsUpdate = true;
      const aarr = artemis.line.geometry.attributes.position.array as Float32Array;
      artemis.pts.forEach((p, i) => aarr.set([p.x - anchor.current.x, p.y - anchor.current.y, p.z - anchor.current.z], i * 3));
      artemis.line.geometry.attributes.position.needsUpdate = true;
    }
    if (linesRef.current) {
      linesRef.current.quaternion.copy(qFrame);
      linesRef.current.position.copy(toWorld(sub(anchor.current, sim.r)));
    }

    // Report to the HUD.
    if (now - lastReport.current > 150) {
      lastReport.current = now;
      const o = sim.orbit();
      const fuel = sim.fuel;
      onTelemetry({
        phase: sim.phase === "ascent" && sim.message ? sim.message : PHASE_LABEL[sim.phase],
        message: sim.message,
        t,
        altitude: sim.altitude,
        verticalSpeed: sim.verticalSpeed,
        orbitalSpeed: sim.orbitalSpeed,
        surfaceSpeed: sim.surfaceSpeed,
        apoapsis: o.apoapsisAlt,
        periapsis: o.periapsisAlt,
        fuelName: fuel.name,
        fuel: fuel.fraction,
        throttle: sim.throttle,
        warp: warpNow,
        maxWarp: sim.maxWarp,
        moonDistance: sim.moonDistance,
        autopilot: sim.autopilot,
        maxG: sim.maxG,
        closestMoon: sim.closestMoon,
        closestMoonT: sim.closestMoonT,
        maxAltitude: sim.maxAltitude,
        maxAltitudeT: sim.maxAltitudeT,
        entryT: sim.entryT,
        done: sim.phase === "splashdown",
        failed: sim.phase === "failed",
      });
    }
  });

  return (
    <>
      <mesh ref={skyRef} renderOrder={-100} frustumCulled={false}>
        <sphereGeometry args={[1000, 64, 32]} />
        <ShaderMat
          key={quality}
          vertexShader={planetVertex}
          fragmentShader={planetFragment}
          uniforms={skyUniforms}
          defines={skyDefines}
          side={THREE.BackSide}
          depthWrite={false}
        />
      </mesh>

      <group ref={siteRef}>
        <LaunchSite rocket={rocket} parts={parts} armSwing={armSwing} />
        <primitive object={smokePoints} />
        <pointLight ref={padLightRef} position={[0, MOUNT_HEIGHT - 2, 6]} color="#ff8a3d" distance={400} decay={2} />
        {!flying && (
          <group position={[8 + 6, 0, 10]} rotation={[0, -0.6, 0]}>
            <Astronaut height={1.8} />
          </group>
        )}
      </group>

      <Rocket ref={rocketRef} rocket={rocket} parts={parts} {...flags} />
      <group ref={smDebrisRef} visible={false}>
        <group position={[0, dims.capsuleBase, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <Spacecraft parts={parts.filter((p) => p !== "capsule")} burning={false} heat={0} scale={1} />
        </group>
      </group>

      <group ref={linesRef}>
        <primitive object={pathLine} />
        <primitive object={moonLine} />
        <primitive object={artemis.line} />
      </group>

      <hemisphereLight ref={hemiRef} args={["#9ec4ff", "#4a4630", 0.55]} />
      <directionalLight
        ref={sunRef}
        intensity={3.4}
        color="#fff4e6"
        castShadow
        shadow-mapSize={quality === "high" ? [1024, 1024] : [192, 192]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
        shadow-camera-left={-90}
        shadow-camera-right={90}
        shadow-camera-top={110}
        shadow-camera-bottom={-90}
        shadow-camera-near={10}
        shadow-camera-far={900}
      />
    </>
  );
}

function mapPiece(p: SimPieceId): PieceId | "serviceModule" {
  return p === "serviceModule" ? "serviceModule" : p;
}

/** Crew access arm swings away in the last seconds of the countdown. */
function useArmSwing(simRef: React.MutableRefObject<FlightSim>, flying: boolean) {
  const swing = useRef(0);
  useFrame(() => {
    swing.current = flying ? THREE.MathUtils.clamp((simRef.current.t - (COUNTDOWN_S - 6)) / 2, 0, 1) : 0;
  });
  return swing;
}

/** Shadows from every part of the rocket. */
function ShadowSetup() {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const id = window.setInterval(() => {
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && !(m.material instanceof THREE.ShaderMaterial) && !m.castShadow) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [scene]);
  return null;
}

export default function FlightScene(props: Props) {
  const { quality } = props;
  return (
    <Canvas
      key={quality}
      shadows
      flat
      dpr={quality === "high" ? [0.75, 1] : [0.5, 0.75]}
      gl={{ antialias: false, logarithmicDepthBuffer: true, powerPreference: "high-performance" }}
      camera={{ position: [70, 30, 100], fov: 45, near: 0.5, far: 5e9 }}
    >
      <World {...props} />
      <ShadowSetup />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={15} maxDistance={2e9} enablePan={false} zoomSpeed={1.4} />
      {quality === "high" ? (
        <EffectComposer multisampling={0}>
          <Bloom intensity={0.6} luminanceThreshold={1.2} luminanceSmoothing={0.3} mipmapBlur />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          <Vignette offset={0.25} darkness={0.55} />
        </EffectComposer>
      ) : (
        <EffectComposer multisampling={0}>
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      )}
    </Canvas>
  );
}

