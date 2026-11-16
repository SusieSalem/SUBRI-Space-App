// The launch site around the pad. The static complex (raised pad with flame
// trench and ramp, lightning masts, tanks, water tower, crawlerway, assembly
// building, trees) is public/models/launch_site.glb; the service tower is
// service_tower.glb, 100 m tall and stretched to fit the rocket. Both are low
// poly, made in Blender (collection SC_LaunchSite). The crew arm stays in code
// because it swings.
// Built in metres in the pad's local frame (+Y up, +X east). It sits on the
// curved Earth drawn by the planet shader and simply falls away as you climb.

import { Suspense, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { PartId } from "../core/design";
import type { RocketId } from "../core/launchCheck";
import { MOUNT_HEIGHT } from "../core/simulate";
import { ROCKET_SPECS, stackDims } from "./Rocket";
import { Model } from "./models";

function useGroundTexture() {
  return useMemo(() => {
    const size = 1024;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d")!;
    const mid = size / 2;
    // Clear canvas so only the crawlerway and concrete hardstand are drawn,
    // letting the planet shader's procedural terrain and atmospheric haze show seamlessly!
    g.clearRect(0, 0, size, size);

    // Soft outer perimeter blend around the concrete pad
    const padGrad = g.createRadialGradient(mid, mid, 64, mid, mid, 92);
    padGrad.addColorStop(0, "rgba(145,143,136,0.85)");
    padGrad.addColorStop(1, "rgba(145,143,136,0)");
    g.fillStyle = padGrad;
    g.beginPath();
    g.arc(mid, mid, 92, 0, Math.PI * 2);
    g.fill();

    // Concrete hardstand around the pad.
    g.fillStyle = "rgb(160,158,152)";
    g.beginPath();
    g.arc(mid, mid, 70, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgb(128,126,120)";
    g.beginPath();
    g.arc(mid, mid, 32, 0, Math.PI * 2);
    g.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;

    return { tex };
  }, []);
}

export default function LaunchSite({ rocket, parts, armSwing }: { rocket: RocketId; parts: PartId[]; armSwing: React.MutableRefObject<number> }) {
  const { tex } = useGroundTexture();
  const dims = stackDims(rocket, parts);
  const r = ROCKET_SPECS[rocket].radius;
  const towerX = -(r + 8);
  const towerH = MOUNT_HEIGHT + dims.total * 0.9;
  const armRef = useRef<THREE.Group>(null);

  useFrame(() => {
    if (armRef.current) armRef.current.rotation.y = armSwing.current * 1.4;
  });

  const grey = useMemo(() => new THREE.MeshStandardMaterial({ color: "#6d7178", roughness: 0.7, metalness: 0.3, flatShading: true }), []);

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[700, 96]} />
        <meshStandardMaterial map={tex} transparent alphaTest={0.05} roughness={0.95} depthWrite />
      </mesh>

      <Suspense fallback={null}>
        <Model name="launch_site" />
      </Suspense>

      {/* Service tower (stretched to the stack) and crew access arm */}
      <group position={[towerX, 0, 0]}>
        <Suspense fallback={null}>
          <Model name="service_tower" scale={[1, towerH / 100, 1]} />
        </Suspense>
        {dims.hasCapsule && (
          <group ref={armRef} position={[3, MOUNT_HEIGHT + dims.hatchHeight, 0]}>
            <mesh position={[(-towerX - 3 - 2.6) / 2, 0, 0]} castShadow material={grey}>
              <boxGeometry args={[-towerX - 3 - 2.6, 2.2, 2]} />
            </mesh>
          </group>
        )}
      </group>
    </group>
  );
}
