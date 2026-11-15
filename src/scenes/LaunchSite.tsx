// The launch site around the pad: ground patch, launch mount, service tower with
// the crew access arm, lightning masts, water tower and the assembly building.
// Built in metres in the pad's local frame (+Y up, +X east). It sits on the
// curved Earth drawn by the planet shader and simply falls away as you climb.

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { PartId } from "../core/design";
import type { RocketId } from "../core/launchCheck";
import { MOUNT_HEIGHT } from "../core/simulate";
import { ROCKET_SPECS, stackDims } from "./Rocket";

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

    // Crawlerway to the assembly building (towards -X, -Z) with soft gravel shoulders.
    g.save();
    g.translate(mid, mid);
    g.rotate(Math.atan2(-900, -800));
    g.fillStyle = "rgba(130,126,116,0.45)";
    g.fillRect(0, -14, mid * 1.5, 28);
    g.fillStyle = "rgb(150,146,136)";
    g.fillRect(0, -9, mid * 1.5, 18);
    g.restore();

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

  const concrete = useMemo(() => new THREE.MeshStandardMaterial({ color: "#8f8c86", roughness: 0.9 }), []);
  const steel = useMemo(() => new THREE.MeshStandardMaterial({ color: "#b8452f", roughness: 0.6, metalness: 0.4 }), []);
  const grey = useMemo(() => new THREE.MeshStandardMaterial({ color: "#6d7178", roughness: 0.7, metalness: 0.3 }), []);
  const building = useMemo(() => new THREE.MeshStandardMaterial({ color: "#d8d6d0", roughness: 0.85 }), []);

  const levels = Math.floor(towerH / 6);

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[700, 96]} />
        <meshStandardMaterial map={tex} transparent roughness={0.95} depthWrite={false} />
      </mesh>

      {/* Launch mount with flame trench */}
      <mesh position={[-14, MOUNT_HEIGHT / 2, 0]} castShadow receiveShadow material={concrete}>
        <boxGeometry args={[16, MOUNT_HEIGHT, 30]} />
      </mesh>
      <mesh position={[14, MOUNT_HEIGHT / 2, 0]} castShadow receiveShadow material={concrete}>
        <boxGeometry args={[16, MOUNT_HEIGHT, 30]} />
      </mesh>
      <mesh position={[0, MOUNT_HEIGHT - 0.6, 0]} castShadow receiveShadow material={grey}>
        <boxGeometry args={[14, 1.2, 14]} />
      </mesh>

      {/* Service tower: four legs, cross members, crew access arm */}
      <group position={[towerX, 0, 0]}>
        {[
          [-2.5, -2.5],
          [2.5, -2.5],
          [-2.5, 2.5],
          [2.5, 2.5],
        ].map(([x, z], i) => (
          <mesh key={i} position={[x, towerH / 2, z]} castShadow material={steel}>
            <boxGeometry args={[0.6, towerH, 0.6]} />
          </mesh>
        ))}
        {Array.from({ length: levels }).map((_, i) => (
          <group key={i} position={[0, 6 * (i + 1), 0]}>
            <mesh castShadow material={steel}>
              <boxGeometry args={[5.6, 0.4, 0.4]} />
            </mesh>
            <mesh castShadow material={steel}>
              <boxGeometry args={[0.4, 0.4, 5.6]} />
            </mesh>
            <mesh position={[0, -3, 2.5]} rotation={[0, 0, Math.atan2(6, 5)]} castShadow material={steel}>
              <boxGeometry args={[7.8, 0.25, 0.25]} />
            </mesh>
          </group>
        ))}
        <mesh position={[0, towerH + 4, 0]} material={grey}>
          <cylinderGeometry args={[0.15, 0.3, 8, 8]} />
        </mesh>
        {dims.hasCapsule && (
          <group ref={armRef} position={[2.5, MOUNT_HEIGHT + dims.hatchHeight, 0]}>
            <mesh position={[(-towerX - 2.5 - 2.6) / 2, 0, 0]} castShadow material={grey}>
              <boxGeometry args={[-towerX - 2.5 - 2.6, 2.2, 2]} />
            </mesh>
          </group>
        )}
      </group>

      {/* Lightning masts */}
      {[
        [40, 40],
        [-40, 40],
        [0, -50],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, 45, z]} castShadow material={grey}>
          <cylinderGeometry args={[0.4, 0.9, 90, 8]} />
        </mesh>
      ))}

      {/* Water tower */}
      <group position={[90, 0, -70]}>
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} position={[Math.cos((i * Math.PI) / 2) * 5, 15, Math.sin((i * Math.PI) / 2) * 5]} castShadow material={grey}>
            <cylinderGeometry args={[0.4, 0.4, 30, 6]} />
          </mesh>
        ))}
        <mesh position={[0, 34, 0]} castShadow material={building}>
          <sphereGeometry args={[9, 24, 16]} />
        </mesh>
      </group>

      {/* Assembly building in the distance */}
      <group position={[-800, 0, -900]}>
        <mesh position={[0, 80, 0]} castShadow receiveShadow material={building}>
          <boxGeometry args={[150, 160, 160]} />
        </mesh>
        <mesh position={[76, 60, 0]}>
          <planeGeometry args={[1, 1]} />
        </mesh>
        <mesh position={[75.2, 65, 0]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[50, 130]} />
          <meshStandardMaterial color="#5f6266" roughness={0.8} />
        </mesh>
        <mesh position={[60, 20, 110]} castShadow material={building}>
          <boxGeometry args={[60, 40, 60]} />
        </mesh>
      </group>
    </group>
  );
}
