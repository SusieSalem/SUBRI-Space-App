// Placeholder crew spacecraft built from primitives: capsule, service module,
// engine, solar wings and an optional radiation shield ring. It changes with the
// parts picked in the design panel. Uses the Blender models in public/models/;
// the primitives are only shown while those load.

import { Suspense, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import ShaderMat from "./ShaderMat";
import type { PartId } from "../core/design";
import { billboardVertex, plumeFragment } from "./shaders/space";
import { Model } from "./models";

// The Blender models are +Y up; this turns +Y into the spacecraft's +Z nose axis.
const Y_TO_Z: [number, number, number] = [Math.PI / 2, 0, 0];

interface Props {
  parts: PartId[];
  burning: boolean;
  heat: number;
  /** Size multiplier. Default shrinks metres to space-scene units. */
  scale?: number;
  /** Solar wings folded along the body, as they are under the fairing at launch. */
  folded?: boolean;
}

// The model is built in metres and scaled down. Nose points along +Z.
export const SPACECRAFT_SCALE = 0.0011;

const white = new THREE.MeshStandardMaterial({ color: "#d9dde3", metalness: 0.2, roughness: 0.45 });
const silver = new THREE.MeshStandardMaterial({ color: "#a9aeb5", metalness: 0.85, roughness: 0.3 });
const dark = new THREE.MeshStandardMaterial({ color: "#2a2724", metalness: 0.3, roughness: 0.7 });
const panel = new THREE.MeshStandardMaterial({ color: "#14244a", metalness: 0.6, roughness: 0.25, emissive: "#050a18" });
const shield = new THREE.MeshStandardMaterial({ color: "#7a6a52", metalness: 0.4, roughness: 0.6 });

export default function Spacecraft({ parts, burning, heat, scale = SPACECRAFT_SCALE, folded = false }: Props) {
  const hasCapsule = parts.includes("capsule");
  const service = parts.includes("serviceLarge") ? "large" : parts.includes("serviceSmall") ? "small" : null;
  const hasSolar = parts.includes("solarPanels");
  const hasShield = parts.includes("radiationShield");
  const serviceLength = service === "large" ? 4.8 : 3.0;

  const capsuleGeo = useMemo(() => {
    // Truncated cone, base wider than the top, like most crew capsules.
    const pts = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(2.5, 0),
      new THREE.Vector2(2.52, 0.25),
      new THREE.Vector2(1.0, 3.0),
      new THREE.Vector2(0.75, 3.3),
      new THREE.Vector2(0, 3.35),
    ];
    const g = new THREE.LatheGeometry(pts, 48);
    g.rotateX(Math.PI / 2);
    return g;
  }, []);

  const plumeUniforms = useMemo(() => ({ uTime: { value: 0 }, uThrottle: { value: 0 } }), []);
  const heatUniforms = useMemo(() => ({ uHeat: { value: 0 } }), []);
  const plumeRef = useRef<THREE.Mesh>(null);

  useFrame((state, dt) => {
    plumeUniforms.uTime.value = state.clock.elapsedTime;
    const target = burning ? 1 : 0;
    const u = plumeUniforms.uThrottle;
    u.value += (target - u.value) * Math.min(1, dt * 6);
    if (plumeRef.current) plumeRef.current.visible = u.value > 0.01;
    heatUniforms.uHeat.value = heat;
  });

  const serviceZ = -serviceLength / 2 - 0.3;
  const engineZ = -serviceLength - 0.3;

  return (
    <group scale={scale}>
      {hasCapsule && (
        <Suspense
          fallback={
            <>
              <mesh geometry={capsuleGeo} material={silver} />
              <mesh position={[0, 0, -0.05]} rotation={[Math.PI / 2, 0, 0]} material={dark}>
                <cylinderGeometry args={[2.55, 2.55, 0.12, 48]} />
              </mesh>
            </>
          }
        >
          <Model name="capsule" rotation={Y_TO_Z} />
        </Suspense>
      )}

      {hasShield && (
        <Suspense
          fallback={
            <mesh position={[0, 0, 0.9]} material={shield}>
              <torusGeometry args={[2.05, 0.18, 12, 48]} />
            </mesh>
          }
        >
          <Model name="radiation_shield" position={[0, 0, 0.9]} rotation={Y_TO_Z} />
        </Suspense>
      )}

      {service && (
        <group>
          <Suspense
            fallback={
              <mesh position={[0, 0, serviceZ]} rotation={[Math.PI / 2, 0, 0]} material={white}>
                <cylinderGeometry args={[2.3, 2.3, serviceLength, 40]} />
              </mesh>
            }
          >
            {/* model origin = top of the service module, engine bell included */}
            <Model name={service === "large" ? "service_large" : "service_small"} position={[0, 0, -0.3]} rotation={Y_TO_Z} />
          </Suspense>
          {/* plume, apex at the nozzle and widening behind */}
          <mesh ref={plumeRef} position={[0, 0, engineZ - 1.4 - 4]} rotation={[Math.PI / 2, 0, 0]}>
            <coneGeometry args={[2.2, 8, 24, 1, true]} />
            <ShaderMat
              vertexShader={billboardVertex}
              fragmentShader={plumeFragment}
              uniforms={plumeUniforms}
              transparent
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              side={THREE.DoubleSide}
            />
          </mesh>
          {hasSolar &&
            [0, 1, 2, 3].map((i) => (
              <group key={i} position={[0, 0, serviceZ]} rotation={[0, 0, Math.PI / 4 + (i * Math.PI) / 2]}>
                <Suspense
                  fallback={
                    <mesh position={folded ? [2.42, 0, 0] : [5.9, 0, 0]} material={panel}>
                      <boxGeometry args={folded ? [0.1, 0.06, serviceLength * 0.9] : [7, 0.06, 1.9]} />
                    </mesh>
                  }
                >
                  {folded ? (
                    // folded stack lies flat on the hull, stretched to the module's length
                    <Model name="solar_wing_folded" position={[2.33, 0, 0]} rotation={Y_TO_Z} scale={[1, (serviceLength * 0.9) / 2.7, 1]} />
                  ) : (
                    // origin at the hinge, wing runs out along +X
                    <Model name="solar_wing_deployed" position={[2.3, 0, 0]} rotation={Y_TO_Z} />
                  )}
                </Suspense>
              </group>
            ))}
        </group>
      )}

      {/* re-entry plasma around the heat shield */}
      {heat > 0.01 && (
        <mesh position={[0, 0, -0.6]} scale={[1, 1, 1.6]}>
          <sphereGeometry args={[3.4, 32, 16]} />
          <ShaderMat
            uniforms={heatUniforms}
            vertexShader={heatVertex}
            fragmentShader={heatFragment}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      )}
    </group>
  );
}

const heatVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

const heatFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uHeat;
varying vec3 vN;
varying vec3 vV;
void main() {
  float rim = pow(1.0 - abs(dot(vN, vV)), 2.0);
  vec3 col = mix(vec3(1.0, 0.35, 0.08), vec3(1.0, 0.8, 0.5), rim) * (0.6 + rim * 3.0) * uHeat;
  gl_FragColor = vec4(col, uHeat * 0.8);
  #include <logdepthbuf_fragment>
}
`;
