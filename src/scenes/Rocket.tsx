// The full launch stack built from primitives, in metres, base of the first
// stage at y = 0: boosters (Medium and Heavy), first stage, second stage,
// adapter, the crew spacecraft and its launch escape tower.
// Each detachable piece is its own group so the ascent can drop it off.
// Generic look on purpose: no real rocket's livery or logos.
// Geometry comes from the Blender models in public/models/ (rocket_*.glb,
// escape_tower.glb); the primitives below are only shown while they load.

import { Suspense, forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import * as THREE from "three";
import ShaderMat from "./ShaderMat";
import type { PartId } from "../core/design";
import type { RocketId } from "../core/launchCheck";
import Spacecraft from "./Spacecraft";
import { Model, type ModelName } from "./models";
import { billboardVertex, plumeFragment } from "./shaders/space";

export type PieceId = "boosters" | "stage1" | "stage2" | "escapeTower" | "spacecraft";

interface RocketSpec {
  radius: number;
  stage1Height: number;
  interstage: number;
  stage2Height: number;
  boosters: { count: number; radius: number; height: number } | null;
  stage1Engines: number;
}

export const ROCKET_SPECS: Record<RocketId, RocketSpec> = {
  light: { radius: 1.7, stage1Height: 24, interstage: 2, stage2Height: 9, boosters: null, stage1Engines: 1 },
  medium: {
    radius: 2.2,
    stage1Height: 34,
    interstage: 2.5,
    stage2Height: 11,
    boosters: { count: 2, radius: 0.95, height: 20 },
    stage1Engines: 1,
  },
  heavy: {
    radius: 2.6,
    stage1Height: 44,
    interstage: 3,
    stage2Height: 13,
    boosters: { count: 2, radius: 2.0, height: 40 },
    stage1Engines: 4,
  },
};

const ADAPTER_HEIGHT = 2.6;
const CAPSULE_HEIGHT = 3.35;

export interface StackDims {
  stage2Base: number;
  adapterTop: number;
  /** Where the spacecraft's origin (capsule base) sits. */
  capsuleBase: number;
  capsuleTop: number;
  hatchHeight: number;
  total: number;
  hasCapsule: boolean;
}

export function stackDims(rocket: RocketId, parts: PartId[]): StackDims {
  const spec = ROCKET_SPECS[rocket];
  const service = parts.includes("serviceLarge") ? 4.8 : parts.includes("serviceSmall") ? 3.0 : 0;
  const stage2Base = spec.stage1Height + spec.interstage;
  const adapterTop = stage2Base + spec.stage2Height + ADAPTER_HEIGHT;
  const capsuleBase = adapterTop + (service > 0 ? service + 0.3 : 0.1);
  const hasCapsule = parts.includes("capsule");
  const capsuleTop = capsuleBase + (hasCapsule ? CAPSULE_HEIGHT + 0.5 : 0);
  const total = capsuleTop + (hasCapsule ? 9.5 : 0);
  return { stage2Base, adapterTop, capsuleBase, capsuleTop, hatchHeight: capsuleBase + 1.8, total, hasCapsule };
}

const body = new THREE.MeshStandardMaterial({ color: "#e9ebee", roughness: 0.5, metalness: 0.05 });
const darkBand = new THREE.MeshStandardMaterial({ color: "#23262b", roughness: 0.6, metalness: 0.2 });
const engineMat = new THREE.MeshStandardMaterial({ color: "#3a3633", roughness: 0.45, metalness: 0.8 });
const towerMat = new THREE.MeshStandardMaterial({ color: "#f2f2f2", roughness: 0.4, metalness: 0.1 });

export type PlumeUniforms = {
  uTime: { value: number };
  uThrottle: { value: number };
  [key: string]: { value: number };
};

export interface RocketHandle {
  pieces: Record<PieceId, THREE.Group | null>;
  plumes: { boosters: PlumeUniforms; stage1: PlumeUniforms; stage2: PlumeUniforms };
  /** Nozzle exit heights in stack coordinates, for smoke and lighting. */
  nozzleY: { stage1: number; stage2: number };
  /** Plume length multiplier; grows as the air thins. */
  setPlumeLength: (k: number) => void;
}

function Plume({ uniforms, radius, length }: { uniforms: PlumeUniforms; radius: number; length: number }) {
  return (
    <mesh position={[0, -length / 2, 0]} renderOrder={5}>
      <coneGeometry args={[radius, length, 20, 1, true]} />
      <ShaderMat
        vertexShader={billboardVertex}
        fragmentShader={plumeFragment}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function Engine({ radius }: { radius: number }) {
  return (
    <mesh position={[0, -radius * 0.7, 0]} material={engineMat}>
      <cylinderGeometry args={[radius * 0.45, radius, radius * 1.4, 20, 1, true]} />
    </mesh>
  );
}

interface Props {
  rocket: RocketId;
  parts: PartId[];
  /** Solar wings deployed (after leaving the upper stage). */
  deployed?: boolean;
  /** Only the capsule is left (service module dropped before re-entry). */
  capsuleOnly?: boolean;
  /** Service module engine firing. */
  serviceBurning?: boolean;
  /** 0..1 re-entry plasma. */
  heat?: number;
}

const Rocket = forwardRef<RocketHandle, Props>(function Rocket(
  { rocket, parts, deployed = false, capsuleOnly = false, serviceBurning = false, heat = 0 },
  ref,
) {
  const spec = ROCKET_SPECS[rocket];
  const dims = stackDims(rocket, parts);
  const r = spec.radius;

  const plumes = useMemo(
    () => ({
      boosters: { uTime: { value: 0 }, uThrottle: { value: 0 } },
      stage1: { uTime: { value: 0 }, uThrottle: { value: 0 } },
      stage2: { uTime: { value: 0 }, uThrottle: { value: 0 } },
    }),
    [],
  );
  const boosters = useRef<THREE.Group>(null);
  const stage1 = useRef<THREE.Group>(null);
  const stage2 = useRef<THREE.Group>(null);
  const spacecraft = useRef<THREE.Group>(null);
  const escapeTower = useRef<THREE.Group>(null);
  const plumeScale = useRef<THREE.Group[]>([]);

  const engineR = spec.stage1Engines === 1 ? r * 0.55 : r * 0.3;
  const engineDrop = engineR * 1.4;

  useImperativeHandle(
    ref,
    () => ({
      get pieces() {
        return {
          boosters: boosters.current,
          stage1: stage1.current,
          stage2: stage2.current,
          escapeTower: escapeTower.current,
          spacecraft: spacecraft.current,
        };
      },
      plumes,
      nozzleY: { stage1: -engineDrop, stage2: dims.stage2Base - 1.2 },
      setPlumeLength: (k: number) => {
        for (const g of plumeScale.current) if (g) g.scale.set(1 + (k - 1) * 0.6, k, 1 + (k - 1) * 0.6);
      },
    }),
    [plumes, engineDrop, dims.stage2Base],
  );

  const addPlumeGroup = (g: THREE.Group | null) => {
    if (g && !plumeScale.current.includes(g)) plumeScale.current.push(g);
  };

  const enginePositions: [number, number][] =
    spec.stage1Engines === 1
      ? [[0, 0]]
      : [
          [r * 0.45, r * 0.45],
          [-r * 0.45, r * 0.45],
          [r * 0.45, -r * 0.45],
          [-r * 0.45, -r * 0.45],
        ];

  const model: ModelName = `rocket_${rocket}`;

  // Primitive shapes, shown only while the Blender model loads.
  const boosterPlaceholder = spec.boosters && (
    <>
      {[1, -1].map((side) => {
        const b = spec.boosters!;
        return (
          <group key={side} position={[0, 0, side * (r + b.radius + 0.15)]}>
            <mesh position={[0, b.height / 2, 0]} material={body}>
              <cylinderGeometry args={[b.radius, b.radius, b.height, 28]} />
            </mesh>
            <mesh position={[0, b.height + b.radius * 1.2, 0]} material={body}>
              <coneGeometry args={[b.radius, b.radius * 2.4, 28]} />
            </mesh>
            <Engine radius={b.radius * 0.6} />
          </group>
        );
      })}
    </>
  );
  const stage1Placeholder = (
    <>
      <mesh position={[0, spec.stage1Height / 2, 0]} material={body}>
        <cylinderGeometry args={[r, r, spec.stage1Height, 40]} />
      </mesh>
      <mesh position={[0, spec.stage1Height + spec.interstage / 2, 0]} material={darkBand}>
        <cylinderGeometry args={[r, r, spec.interstage, 40]} />
      </mesh>
      {enginePositions.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <Engine radius={engineR} />
        </group>
      ))}
    </>
  );
  const stage2Placeholder = (
    <>
      <mesh position={[0, dims.stage2Base + spec.stage2Height / 2, 0]} material={body}>
        <cylinderGeometry args={[r, r, spec.stage2Height, 40]} />
      </mesh>
      <mesh position={[0, dims.stage2Base + spec.stage2Height + ADAPTER_HEIGHT / 2, 0]} material={body}>
        <cylinderGeometry args={[2.35, r, ADAPTER_HEIGHT, 40]} />
      </mesh>
      <group position={[0, dims.stage2Base, 0]}>
        <Engine radius={r * 0.5} />
      </group>
    </>
  );
  const towerPlaceholder = (
    <>
      <mesh position={[0, 1.75, 0]} material={towerMat}>
        <cylinderGeometry args={[1.12, 2.62, 3.5, 40]} />
      </mesh>
      <mesh position={[0, 6.2, 0]} material={darkBand}>
        <cylinderGeometry args={[0.32, 0.4, 4, 16]} />
      </mesh>
    </>
  );

  return (
    <>
      {/* Boosters, on the +Z/-Z sides so they clear the service tower on -X */}
      <group ref={boosters}>
        {spec.boosters && (
          <>
            <Suspense fallback={boosterPlaceholder}>
              <Model name={model} node="boosters" />
            </Suspense>
            {[1, -1].map((side) => {
              const b = spec.boosters!;
              return (
                <group key={side} position={[0, -b.radius * 0.84, side * (r + b.radius + 0.15)]} ref={addPlumeGroup}>
                  <Plume uniforms={plumes.boosters} radius={b.radius * 1.3} length={b.height * 0.55} />
                </group>
              );
            })}
          </>
        )}
      </group>

      {/* First stage (tank, interstage, engines) */}
      <group ref={stage1}>
        <Suspense fallback={stage1Placeholder}>
          <Model name={model} node="stage1" />
        </Suspense>
        <group position={[0, -engineDrop, 0]} ref={addPlumeGroup}>
          <Plume uniforms={plumes.stage1} radius={r * 1.15} length={spec.stage1Height * 0.5} />
        </group>
      </group>

      {/* Second stage and adapter */}
      <group ref={stage2}>
        <Suspense fallback={stage2Placeholder}>
          <Model name={model} node="stage2" />
        </Suspense>
        <group position={[0, dims.stage2Base - r * 0.7, 0]} ref={addPlumeGroup}>
          <Plume uniforms={plumes.stage2} radius={r * 1.4} length={spec.stage2Height * 0.9} />
        </group>
      </group>

      {/* Crew spacecraft: service module and capsule */}
      <group ref={spacecraft}>
        <group position={[0, dims.capsuleBase, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <Spacecraft
            parts={capsuleOnly ? parts.filter((p) => p === "capsule") : parts}
            burning={serviceBurning}
            heat={heat}
            scale={1}
            folded={!deployed}
          />
        </group>
      </group>

      {/* Launch escape tower: cover over the capsule, tower and abort motor */}
      <group ref={escapeTower}>
        {dims.hasCapsule && (
          <group position={[0, dims.capsuleBase, 0]}>
            <Suspense fallback={towerPlaceholder}>
              <Model name="escape_tower" />
            </Suspense>
          </group>
        )}
      </group>
    </>
  );
});

export default Rocket;
