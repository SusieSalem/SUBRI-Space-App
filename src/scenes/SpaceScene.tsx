// The main 3D scene: Earth with atmosphere and clouds, the Moon, stars, the Sun,
// and the crew spacecraft flying the mission path.

import { useEffect, useMemo, useReducer, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { PartId } from "../core/design";
import Astronaut from "./Astronaut";
import Spacecraft, { SPACECRAFT_SCALE } from "./Spacecraft";
import {
  EARTH_RADIUS,
  MOON_POSITION,
  MOON_RADIUS,
  SUN_DIRECTION,
  missionStateAt,
  newMissionState,
  plannedPathPoints,
  type MissionState,
} from "./mission";
import { atmosphereFragment, atmosphereVertex } from "./shaders/atmosphere";
import { cloudFragment, earthFragment, earthVertex } from "./shaders/earth";
import { billboardVertex, moonFragment, starsFragment, starsVertex, sunGlowFragment } from "./shaders/space";

const ATMOSPHERE_RADIUS = 1.06;

export interface MissionClock {
  running: boolean;
  time: number;
  speed: number;
}

interface SceneProps {
  parts: PartId[];
  clock: React.MutableRefObject<MissionClock>;
  follow: boolean;
  onState: (s: MissionState) => void;
}

function Earth() {
  const groupRef = useRef<THREE.Group>(null);
  const atmoRef = useRef<THREE.ShaderMaterial>(null);
  const earthUniforms = useMemo(() => ({ uSunDir: { value: SUN_DIRECTION } }), []);
  const cloudUniforms = useMemo(() => ({ uSunDir: { value: SUN_DIRECTION }, uTime: { value: 0 } }), []);
  const atmoUniforms = useMemo(
    () => ({
      uSunDir: { value: SUN_DIRECTION },
      uCenter: { value: new THREE.Vector3() },
      uPlanetRadius: { value: EARTH_RADIUS },
      uAtmoRadius: { value: ATMOSPHERE_RADIUS },
      uSunIntensity: { value: 7 },
    }),
    [],
  );

  useFrame(({ camera, clock }, dt) => {
    if (groupRef.current) groupRef.current.rotation.y += dt * 0.01;
    cloudUniforms.uTime.value = clock.elapsedTime;
    // Inside the atmosphere, draw the back of the shell so the sky still shows.
    if (atmoRef.current) {
      const inside = camera.position.length() < ATMOSPHERE_RADIUS;
      const side = inside ? THREE.BackSide : THREE.FrontSide;
      if (atmoRef.current.side !== side) {
        atmoRef.current.side = side;
        atmoRef.current.needsUpdate = true;
      }
    }
  });

  return (
    <>
      <group ref={groupRef}>
        <mesh>
          <sphereGeometry args={[EARTH_RADIUS, 160, 80]} />
          <shaderMaterial vertexShader={earthVertex} fragmentShader={earthFragment} uniforms={earthUniforms} />
        </mesh>
        <mesh renderOrder={1}>
          <sphereGeometry args={[EARTH_RADIUS * 1.008, 128, 64]} />
          <shaderMaterial
            vertexShader={earthVertex}
            fragmentShader={cloudFragment}
            uniforms={cloudUniforms}
            transparent
            depthWrite={false}
          />
        </mesh>
      </group>
      <mesh renderOrder={2}>
        <sphereGeometry args={[ATMOSPHERE_RADIUS, 128, 64]} />
        <shaderMaterial
          ref={atmoRef}
          vertexShader={atmosphereVertex}
          fragmentShader={atmosphereFragment}
          uniforms={atmoUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </>
  );
}

function Moon() {
  const uniforms = useMemo(() => ({ uSunDir: { value: SUN_DIRECTION } }), []);
  return (
    <mesh position={MOON_POSITION}>
      <sphereGeometry args={[MOON_RADIUS, 96, 48]} />
      <shaderMaterial vertexShader={earthVertex} fragmentShader={moonFragment} uniforms={uniforms} />
    </mesh>
  );
}

/** Sky sphere that follows the camera so the stars are always at infinity. */
function Stars() {
  const ref = useRef<THREE.Mesh>(null);
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  useFrame(({ camera, clock }) => {
    ref.current?.position.copy(camera.position);
    uniforms.uTime.value = clock.elapsedTime;
  });
  return (
    <mesh ref={ref} renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[400, 64, 32]} />
      <shaderMaterial
        vertexShader={starsVertex}
        fragmentShader={starsFragment}
        uniforms={uniforms}
        side={THREE.BackSide}
        depthWrite={false}
      />
    </mesh>
  );
}

function Sun() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ camera }) => {
    if (!ref.current) return;
    ref.current.position.copy(camera.position).addScaledVector(SUN_DIRECTION, 200);
    ref.current.quaternion.copy(camera.quaternion);
  });
  return (
    <>
      <mesh ref={ref} renderOrder={-5} frustumCulled={false}>
        <planeGeometry args={[60, 60]} />
        <shaderMaterial
          vertexShader={billboardVertex}
          fragmentShader={sunGlowFragment}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <directionalLight position={SUN_DIRECTION.clone().multiplyScalar(50)} intensity={3.2} />
      <ambientLight intensity={0.04} />
    </>
  );
}

function FlightPath() {
  const points = useMemo(() => plannedPathPoints(), []);
  return <Line points={points} color="#5fa8ff" lineWidth={1} transparent opacity={0.28} dashed dashSize={0.08} gapSize={0.06} />;
}

function Ship({ parts, clock, follow, onState }: SceneProps) {
  const ref = useRef<THREE.Group>(null);
  const state = useMemo(() => newMissionState(), []);
  const prev = useMemo(() => new THREE.Vector3(), []);
  const look = useMemo(() => new THREE.Vector3(), []);
  const ahead = useMemo(() => newMissionState(), []);
  const lastPhase = useRef<string>("");
  const lastReport = useRef(0);
  const visual = useRef({ burning: false, heat: 0 });
  const controls = useThree((s) => s.controls) as unknown as OrbitControlsImpl | null;
  const camera = useThree((s) => s.camera);

  useFrame((_, dt) => {
    const c = clock.current;
    if (c.running) c.time += Math.min(dt, 0.1) * c.speed;
    missionStateAt(c.time, state);
    visual.current.burning = state.burning;
    visual.current.heat = state.heat;

    const g = ref.current;
    if (!g) return;
    prev.copy(g.position);
    g.position.copy(state.position);

    // Point the nose along the direction of travel.
    missionStateAt(c.time + 0.05, ahead);
    look.copy(ahead.position).sub(state.position);
    if (look.lengthSq() > 1e-10) {
      look.normalize().add(state.position);
      g.lookAt(look);
    } else if (state.phase === "idle") {
      look.copy(state.position).multiplyScalar(2);
      g.lookAt(look);
    }

    // Follow mode: drag the camera along with the spacecraft. On each new
    // phase, re-frame so the body we're heading for sits behind the ship.
    const phaseChanged = state.phase !== lastPhase.current;
    if (follow && controls) {
      if (phaseChanged) frameShip(camera, controls, g.position, state.phase);
      else camera.position.add(g.position.clone().sub(prev));
      controls.target.copy(g.position);
    }

    // Tell the UI about phase changes, plus a slow tick for the clock.
    const now = performance.now();
    if (phaseChanged || now - lastReport.current > 200) {
      lastPhase.current = state.phase;
      lastReport.current = now;
      onState({ ...state, position: state.position.clone() });
    }
  });

  // Snap the camera to the ship when follow mode is switched on.
  useEffect(() => {
    if (!follow || !controls || !ref.current) return;
    frameShip(camera, controls, ref.current.position, lastPhase.current);
    controls.update();
  }, [follow, controls, camera]);

  return (
    <group ref={ref}>
      <SpacecraftLive parts={parts} visual={visual} />
      {/* astronaut floating by the hatch, only if public/models/astronaut.glb exists */}
      <group position={[0.004, 0.002, 0.002]} scale={SPACECRAFT_SCALE}>
        <Astronaut height={1.8} />
      </group>
    </group>
  );
}

/** Puts the camera behind the ship, looking past it towards Earth or the Moon. */
function frameShip(camera: THREE.Camera, controls: OrbitControlsImpl, ship: THREE.Vector3, phase: string) {
  const towardsMoon = phase === "coast" || phase === "flyby";
  const focus = towardsMoon ? MOON_POSITION : new THREE.Vector3();
  const away = ship.clone().sub(focus).normalize();
  const side = new THREE.Vector3(0, 1, 0).cross(away).normalize();
  const dist = towardsMoon ? 0.05 : 0.045;
  camera.position
    .copy(ship)
    .addScaledVector(away, dist)
    .addScaledVector(side, dist * 0.35)
    .add(new THREE.Vector3(0, dist * 0.3, 0));
  controls.target.copy(ship);
}

/** Re-renders the spacecraft only when burn or heat state changes, not every frame. */
function SpacecraftLive({
  parts,
  visual,
}: {
  parts: PartId[];
  visual: React.MutableRefObject<{ burning: boolean; heat: number }>;
}) {
  const [, force] = useStateTick();
  const last = useRef({ burning: false, heat: 0 });
  useFrame(() => {
    const v = visual.current;
    if (v.burning !== last.current.burning || Math.abs(v.heat - last.current.heat) > 0.02) {
      last.current = { ...v };
      force();
    }
  });
  return <Spacecraft parts={parts} burning={last.current.burning} heat={last.current.heat} />;
}

function useStateTick(): [number, () => void] {
  return useReducer((x: number) => x + 1, 0);
}

export default function SpaceScene(props: SceneProps) {
  return (
    <Canvas
      flat
      dpr={[1, 1.5]}
      gl={{ antialias: false, logarithmicDepthBuffer: true, powerPreference: "high-performance" }}
      camera={{ position: [-1.6, 0.9, 3.4], fov: 45, near: 0.0001, far: 2000 }}
    >
      <Stars />
      <Sun />
      <Earth />
      <Moon />
      <FlightPath />
      <Ship {...props} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={0.01} maxDistance={60} />
      <EffectComposer multisampling={4}>
        <Bloom intensity={0.9} luminanceThreshold={1.0} luminanceSmoothing={0.3} mipmapBlur />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <Vignette offset={0.25} darkness={0.6} />
      </EffectComposer>
    </Canvas>
  );
}
