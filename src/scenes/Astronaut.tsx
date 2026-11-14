// Loads public/models/astronaut.glb if it exists and plays its "Idle" action.
// If the file isn't there yet, nothing is rendered.

import { Suspense, useEffect, useMemo, useState } from "react";
import { useAnimations, useGLTF } from "@react-three/drei";
import * as THREE from "three";

const URL = "/models/astronaut.glb";

/** Checks the model exists without throwing (Vite answers missing files with HTML). */
function useModelExists(url: string) {
  const [exists, setExists] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch(url, { method: "HEAD" })
      .then((r) => {
        const type = r.headers.get("content-type") ?? "";
        if (!cancelled) setExists(r.ok && !type.includes("text/html"));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [url]);
  return exists;
}

function AstronautModel({ height }: { height: number }) {
  const { scene, animations } = useGLTF(URL);
  const { actions, names } = useAnimations(animations, scene);

  // Normalise whatever size the export has to the requested height.
  const scale = useMemo(() => {
    const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
    return size.y > 0 ? height / size.y : 1;
  }, [scene, height]);

  useEffect(() => {
    const action = actions.Idle ?? (names[0] ? actions[names[0]] : undefined);
    action?.reset().fadeIn(0.3).play();
    return () => {
      action?.fadeOut(0.3);
    };
  }, [actions, names]);

  return <primitive object={scene} scale={scale} />;
}

export default function Astronaut({ height = 1.8 }: { height?: number }) {
  const exists = useModelExists(URL);
  if (!exists) return null;
  return (
    <Suspense fallback={null}>
      <AstronautModel height={height} />
    </Suspense>
  );
}
