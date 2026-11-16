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
import { lagoonFragment, lagoonVertex } from "./shaders/lagoon";

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
  const sunRef = useRef<THREE.DirectionalLight | null | undefined>(undefined);

  useFrame(({ clock, scene }) => {
    lagoon.uniforms.uTime.value = clock.elapsedTime;
    // follow the scene's sun (looked up once)
    if (sunRef.current === undefined) {
      sunRef.current = null;
      scene.traverse((o) => {
        if (!sunRef.current && (o as THREE.DirectionalLight).isDirectionalLight) sunRef.current = o as THREE.DirectionalLight;
      });
    }
    const sun = sunRef.current;
    if (sun) lagoon.uniforms.uSunDir.value.subVectors(sun.position, sun.target.position).normalize();
    if (armRef.current) armRef.current.rotation.y = armSwing.current * 1.4;
  });

  // Lagoon water and the flat ground pieces of the model (roads, crawlerway):
  // the flat pieces get a depth bias so they never flicker against the terrain.
  const lagoon = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: lagoonVertex,
        fragmentShader: lagoonFragment,
        uniforms: {
          uTime: { value: 0 },
          uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
          uDeep: { value: new THREE.Color("#0d3b4f") },
          uShallow: { value: new THREE.Color("#2f7f8f") },
          uSky: { value: new THREE.Color("#a9c6dd") },
        },
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
    [],
  );
  const prepareSite = (site: THREE.Object3D) => {
    const stripTriangles = (mesh: THREE.Mesh, pred: (x: number, y: number, z: number) => boolean) => {
      const geo = mesh.geometry;
      const pos = geo.getAttribute("position");
      if (!pos) return;
      if (geo.index) {
        const idx = geo.index.array;
        const kept: number[] = [];
        for (let i = 0; i < idx.length; i += 3) {
          const a = idx[i], b = idx[i + 1], c = idx[i + 2];
          const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
          const cy = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3;
          const cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
          if (!pred(cx, cy, cz)) kept.push(a, b, c);
        }
        geo.setIndex(kept);
      } else {
        const keepVerts: number[] = [];
        const keepNorms: number[] = [];
        const norm = geo.getAttribute("normal");
        for (let i = 0; i < pos.count; i += 3) {
          const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
          const cy = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
          const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
          if (!pred(cx, cy, cz)) {
            for (let k = 0; k < 3; k++) {
              keepVerts.push(pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k));
              if (norm) keepNorms.push(norm.getX(i + k), norm.getY(i + k), norm.getZ(i + k));
            }
          }
        }
        geo.setAttribute("position", new THREE.Float32BufferAttribute(keepVerts, 3));
        if (norm) geo.setAttribute("normal", new THREE.Float32BufferAttribute(keepNorms, 3));
      }
      geo.computeBoundingSphere();
    };

    site.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const m = mesh.material as THREE.MeshStandardMaterial;
      if (m.name === "LS_Water") {
        // Hide the pad lagoon/puddle meshes per art direction
        mesh.visible = false;
        mesh.castShadow = false;
      } else if (m.name === "LS_White") {
        // Remove the elevated water tower sphere near the pad (+X > 55, Y > 18)
        stripTriangles(mesh, (x, y) => x > 55 && y > 18);
      } else if (m.name === "LS_Steel") {
        // Remove the water tower stilts at +X > 55 (the 4 lightning masts sit within |X| <= 52)
        stripTriangles(mesh, (x) => x > 55);
      } else if (m.name === "LS_Road" || m.name === "LS_Gravel") {
        m.polygonOffset = true;
        m.polygonOffsetFactor = -2;
        m.polygonOffsetUnits = -2;
        mesh.castShadow = false;
      }
    });
  };

  const grey = useMemo(() => new THREE.MeshStandardMaterial({ color: "#6d7178", roughness: 0.7, metalness: 0.3, flatShading: true }), []);

  return (
    <group>
      <mesh position={[0, 0.2, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[700, 96]} />
        <meshStandardMaterial map={tex} transparent alphaTest={0.05} roughness={0.95} depthWrite polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
      </mesh>

      <Suspense fallback={null}>
        <Model name="launch_site" onLoad={prepareSite} />
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
