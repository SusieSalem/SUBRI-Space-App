// Blender models (.glb in public/models/), exported with +Y up, metres, Draco.
// The Draco decoder is served locally from public/draco/ so the game runs offline.

import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import type { ThreeElements } from "@react-three/fiber";
import type * as THREE from "three";

export const DRACO_PATH = "/draco/";

export type ModelName =
  | "rocket_light"
  | "rocket_medium"
  | "rocket_heavy"
  | "capsule"
  | "service_small"
  | "service_large"
  | "solar_wing_deployed"
  | "solar_wing_folded"
  | "radiation_shield"
  | "escape_tower"
  | "launch_site"
  | "service_tower";

const url = (name: ModelName) => `/models/${name}.glb`;

/**
 * Renders a copy of a model, or of one named node inside it (for example
 * "stage1" in a rocket). Suspends while loading: wrap it in <Suspense> with
 * the primitive placeholder as fallback.
 */
export function Model({ name, node, ...props }: { name: ModelName; node?: string } & ThreeElements["group"]) {
  const gltf = useGLTF(url(name), DRACO_PATH);
  const object = useMemo<THREE.Object3D | null>(() => {
    const src = node ? gltf.nodes[node] : gltf.scene;
    if (!src) return null;
    const copy = src.clone(true);
    copy.position.set(0, 0, 0);
    copy.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    return copy;
  }, [gltf, node]);
  if (!object) return null;
  return (
    <group {...props}>
      <primitive object={object} />
    </group>
  );
}

const ALL: ModelName[] = [
  "rocket_light",
  "rocket_medium",
  "rocket_heavy",
  "capsule",
  "service_small",
  "service_large",
  "solar_wing_deployed",
  "solar_wing_folded",
  "radiation_shield",
  "escape_tower",
  "launch_site",
  "service_tower",
];
for (const n of ALL) useGLTF.preload(url(n), DRACO_PATH);
