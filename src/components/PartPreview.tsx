import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { PartId } from "../core/design";
import type { RocketId } from "../core/launchCheck";
import { DRACO_PATH, type ModelName } from "../scenes/models";

export type PreviewKind = PartId | RocketId;

const RENDER_PX = 160;

interface RendererRig {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  pivot: THREE.Group;
}

let sharedRig: RendererRig | null = null;
let sharedLoader: GLTFLoader | null = null;
const glbCache = new Map<ModelName, Promise<THREE.Group | null>>();
const templateCache = new Map<PreviewKind, Promise<THREE.Group | null>>();
const idleSnapshotCache = new Map<PreviewKind, string>();

function getLoader(): GLTFLoader {
  if (!sharedLoader) {
    const draco = new DRACOLoader();
    draco.setDecoderPath(DRACO_PATH);
    sharedLoader = new GLTFLoader();
    sharedLoader.setDRACOLoader(draco);
  }
  return sharedLoader;
}

function getRig(): RendererRig | null {
  if (sharedRig) return sharedRig;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = RENDER_PX;
    canvas.height = RENDER_PX;
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: "low-power",
    });
    renderer.setSize(RENDER_PX, RENDER_PX, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 50);
    camera.position.set(0, 0.28, 3.25);
    camera.lookAt(0, 0, 0);

    const hemi = new THREE.HemisphereLight("#e6efff", "#1c2840", 1.15);
    const key = new THREE.DirectionalLight("#fff6eb", 2.4);
    key.position.set(3.2, 4.5, 4.2);
    const rim = new THREE.DirectionalLight("#7ec2ff", 1.35);
    rim.position.set(-3.8, 1.5, -2.5);
    const fill = new THREE.DirectionalLight("#cfe0ff", 0.7);
    fill.position.set(-2.5, -2.0, 3.0);
    scene.add(hemi, key, rim, fill);

    const pivot = new THREE.Group();
    scene.add(pivot);

    sharedRig = { renderer, scene, camera, pivot };
    return sharedRig;
  } catch {
    return null;
  }
}

function loadGlb(name: ModelName): Promise<THREE.Group | null> {
  const existing = glbCache.get(name);
  if (existing) return existing;
  const p = new Promise<THREE.Group | null>((resolve) => {
    getLoader().load(
      `/models/${name}.glb`,
      (gltf) => resolve(gltf.scene),
      undefined,
      () => resolve(null),
    );
  });
  glbCache.set(name, p);
  return p;
}

function buildLifeSupportModel(extended: boolean): THREE.Group {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: "#cfd6e0", metalness: 0.72, roughness: 0.28 });
  const o2Tank = new THREE.MeshStandardMaterial({ color: "#4da3ff", metalness: 0.35, roughness: 0.35 });
  const cryoTank = new THREE.MeshStandardMaterial({
    color: extended ? "#e6b95c" : "#e7ebf2",
    metalness: extended ? 0.65 : 0.25,
    roughness: extended ? 0.32 : 0.4,
  });
  const frame = new THREE.MeshStandardMaterial({ color: "#2d3545", metalness: 0.55, roughness: 0.55 });

  // Base rack rings
  const ringGeo = new THREE.TorusGeometry(1.05, 0.055, 10, 32);
  const topRing = new THREE.Mesh(ringGeo, frame);
  topRing.rotation.x = Math.PI / 2;
  topRing.position.y = 0.55;
  const botRing = new THREE.Mesh(ringGeo, frame);
  botRing.rotation.x = Math.PI / 2;
  botRing.position.y = -0.55;
  g.add(topRing, botRing);

  // Spherical O2 / H2O pressure vessels arranged radially
  const sphereCount = extended ? 6 : 3;
  const sphereRadius = extended ? 0.34 : 0.38;
  const orbitR = extended ? 0.66 : 0.58;
  const tankGeo = new THREE.SphereGeometry(sphereRadius, 24, 18);
  for (let i = 0; i < sphereCount; i++) {
    const a = (i / sphereCount) * Math.PI * 2;
    const mesh = new THREE.Mesh(tankGeo, i % 2 === 0 ? o2Tank : cryoTank);
    mesh.position.set(Math.cos(a) * orbitR, extended && i % 2 === 1 ? 0.16 : -0.1, Math.sin(a) * orbitR);
    g.add(mesh);
  }

  // Central CO2 scrubber core + valve manifold
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 1.35, 20), metal);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.18, 20), frame);
  cap.position.y = 0.65;
  g.add(core, cap);

  if (extended) {
    // Upper reserve canisters for the 14-day margin kit
    const upperGeo = new THREE.CapsuleGeometry(0.2, 0.42, 8, 16);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
      const can = new THREE.Mesh(upperGeo, cryoTank);
      can.position.set(Math.cos(a) * 0.58, 0.36, Math.sin(a) * 0.58);
      g.add(can);
    }
  }

  return g;
}

/** Centers and uniformly scales an object around the origin for consistent framing. */
function normalizeObject(root: THREE.Object3D, targetSize = 1.65, tilt?: [number, number, number]): THREE.Group {
  const wrapper = new THREE.Group();
  const inner = new THREE.Group();
  inner.add(root);
  if (tilt) inner.rotation.set(tilt[0], tilt[1], tilt[2]);
  inner.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(inner);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  const scale = targetSize / maxDim;

  inner.position.sub(center).multiplyScalar(scale);
  inner.scale.setScalar(scale);
  wrapper.add(inner);
  return wrapper;
}

async function createTemplate(kind: PreviewKind): Promise<THREE.Group | null> {
  if (kind === "lifeSupport7" || kind === "lifeSupport14") {
    return normalizeObject(buildLifeSupportModel(kind === "lifeSupport14"), 1.55, [0.3, -0.5, 0]);
  }

  if (kind === "solarPanels") {
    const wing = await loadGlb("solar_wing_deployed");
    if (!wing) return null;
    const array = new THREE.Group();
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.65, 0.65, 1.3, 20),
      new THREE.MeshStandardMaterial({ color: "#dfe4ec", metalness: 0.45, roughness: 0.38 }),
    );
    array.add(hub);
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Group();
      arm.rotation.y = Math.PI / 4 + (i * Math.PI) / 2;
      const wCopy = wing.clone(true);
      wCopy.position.set(0.62, 0, 0);
      arm.add(wCopy);
      array.add(arm);
    }
    return normalizeObject(array, 1.78, [0.58, 0.35, -0.18]);
  }

  const glbMap: Record<Exclude<PreviewKind, "lifeSupport7" | "lifeSupport14" | "solarPanels">, ModelName> = {
    capsule: "capsule",
    serviceSmall: "service_small",
    serviceLarge: "service_large",
    radiationShield: "radiation_shield",
    light: "rocket_light",
    medium: "rocket_medium",
    heavy: "rocket_heavy",
  };
  const loaded = await loadGlb(glbMap[kind]);
  if (!loaded) return null;
  const clone = loaded.clone(true);

  if (kind === "light" || kind === "medium" || kind === "heavy") {
    // Angle tall rockets slightly diagonally so their silhouettes fill the square preview well.
    return normalizeObject(clone, 1.9, [0.16, 0.35, -0.34]);
  }
  if (kind === "radiationShield") {
    return normalizeObject(clone, 1.65, [0.55, 0.3, 0]);
  }
  if (kind === "capsule") {
    return normalizeObject(clone, 1.6, [0.22, -0.45, 0]);
  }
  return normalizeObject(clone, 1.65, [0.2, -0.45, 0]);
}

function getTemplate(kind: PreviewKind): Promise<THREE.Group | null> {
  const existing = templateCache.get(kind);
  if (existing) return existing;
  const p = createTemplate(kind);
  templateCache.set(kind, p);
  return p;
}

function renderObjectToCanvas(obj: THREE.Object3D, yaw: number, dest: HTMLCanvasElement) {
  const rig = getRig();
  if (!rig) return;
  rig.pivot.clear();
  rig.pivot.rotation.set(0, yaw, 0);
  rig.pivot.add(obj);
  rig.renderer.clear();
  rig.renderer.render(rig.scene, rig.camera);
  const ctx = dest.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, dest.width, dest.height);
  ctx.drawImage(rig.renderer.domElement, 0, 0, dest.width, dest.height);
  rig.pivot.clear();
}

export function PartPreview({
  kind,
  hovered = false,
  className = "",
}: {
  kind: PreviewKind;
  hovered?: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const objRef = useRef<THREE.Group | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    setReady(false);
    const canvas = canvasRef.current;
    if (!canvas) return;
    getTemplate(kind).then((tpl) => {
      if (!alive || !tpl) return;
      const instance = tpl.clone(true);
      objRef.current = instance;
      setReady(true);
      const snap = idleSnapshotCache.get(kind);
      if (snap) {
        const img = new Image();
        img.onload = () => {
          if (!alive) return;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        };
        img.src = snap;
        return;
      }
      renderObjectToCanvas(instance, 0, canvas);
      const rig = getRig();
      if (rig) {
        try {
          idleSnapshotCache.set(kind, rig.renderer.domElement.toDataURL());
        } catch {
          // Ignore snapshot cache errors if canvas serialization is blocked.
        }
      }
    });
    return () => {
      alive = false;
    };
  }, [kind]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const obj = objRef.current;
    if (!ready || !hovered || !canvas || !obj) {
      if (ready && canvas && obj && !hovered) renderObjectToCanvas(obj, 0, canvas);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const yaw = ((now - start) / 1000) * 1.15;
      renderObjectToCanvas(obj, yaw, canvas);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hovered, kind, ready]);

  return (
    <span className={`model-preview ${className}`} aria-hidden="true">
      <canvas ref={canvasRef} width={RENDER_PX} height={RENDER_PX} />
    </span>
  );
}
