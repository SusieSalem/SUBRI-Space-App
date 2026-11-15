// Smoke and exhaust particles: a GPU point cloud where each puff only stores
// where and when it was born; the shader works out where it has drifted to.
// Positions are in the pad's local frame, so the smoke stays with the ground
// and the air (which turn with the Earth).

import { useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

const MAX_PUFFS = 900;

const smokeVertex = /* glsl */ `
attribute vec3 aStart;
attribute vec3 aVel;
attribute float aBirth;
attribute float aLife;
attribute float aSize;
uniform float uTime;
uniform float uPixel;
varying float vAge;
varying float vSeed;
void main() {
  float age = (uTime - aBirth) / aLife;
  vAge = age;
  vSeed = fract(aBirth * 13.17);
  float t = uTime - aBirth;
  // Fast at first, then the air slows the puff down; it rises a little as it cools.
  vec3 pos = aStart + aVel * (1.0 - exp(-t * 1.2)) / 1.2 + vec3(0.0, 4.0 * t, 0.0);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = aSize * (0.35 + 1.4 * sqrt(clamp(age, 0.0, 1.0)));
  gl_PointSize = (age < 0.0 || age > 1.0) ? 0.0 : clamp(size * uPixel / -mv.z, 0.0, 512.0);
}
`;

const smokeFragment = /* glsl */ `
uniform vec3 uSunDir;
uniform float uLight;
varying float vAge;
varying float vSeed;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  // Fake a lit sphere: brighter on the side facing the sun.
  vec3 n = vec3(p.x, -p.y, sqrt(1.0 - r2));
  float lit = 0.55 + 0.45 * clamp(dot(n, normalize(vec3(uSunDir.x, uSunDir.y, 0.4))), 0.0, 1.0);
  float a = pow(1.0 - r2, 1.5) * (1.0 - smoothstep(0.55, 1.0, vAge)) * smoothstep(0.0, 0.05, vAge);
  vec3 col = vec3(0.86, 0.85, 0.83) * lit * uLight;
  // Fresh exhaust glows orange near the flame.
  col += vec3(2.4, 1.0, 0.3) * (1.0 - smoothstep(0.0, 0.06, vAge)) * 2.0;
  gl_FragColor = vec4(col, a * (0.55 + 0.2 * vSeed));
}
`;

export interface SmokeHandle {
  emit: (pos: THREE.Vector3, vel: THREE.Vector3, life: number, size: number) => void;
  time: { value: number };
}

export function useSmoke(): [THREE.Points, SmokeHandle] {
  const size = useThree((s) => s.size);
  const cam = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const points = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_PUFFS * 3), 3));
    geo.setAttribute("aStart", new THREE.BufferAttribute(new Float32Array(MAX_PUFFS * 3), 3));
    geo.setAttribute("aVel", new THREE.BufferAttribute(new Float32Array(MAX_PUFFS * 3), 3));
    const birth = new Float32Array(MAX_PUFFS).fill(-1e6);
    geo.setAttribute("aBirth", new THREE.BufferAttribute(birth, 1));
    geo.setAttribute("aLife", new THREE.BufferAttribute(new Float32Array(MAX_PUFFS).fill(1), 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(MAX_PUFFS), 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: smokeVertex,
      fragmentShader: smokeFragment,
      uniforms: {
        uTime: { value: 0 },
        uPixel: { value: 800 },
        uSunDir: { value: new THREE.Vector3(0.6, 0.6, 0.5).normalize() },
        uLight: { value: 0.9 },
      },
      transparent: true,
      depthWrite: false,
    });
    const p = new THREE.Points(geo, mat);
    p.frustumCulled = false;
    p.renderOrder = 10;
    return p;
  }, []);

  const mat = points.material as THREE.ShaderMaterial;
  mat.uniforms.uPixel.value = size.height / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)));

  const cursor = useRef(0);
  const handle = useMemo<SmokeHandle>(
    () => ({
      time: mat.uniforms.uTime,
      emit: (pos, vel, life, sz) => {
        const g = points.geometry;
        const i = cursor.current;
        cursor.current = (i + 1) % MAX_PUFFS;
        (g.attributes.aStart.array as Float32Array).set([pos.x, pos.y, pos.z], i * 3);
        (g.attributes.aVel.array as Float32Array).set([vel.x, vel.y, vel.z], i * 3);
        (g.attributes.aBirth.array as Float32Array)[i] = mat.uniforms.uTime.value;
        (g.attributes.aLife.array as Float32Array)[i] = life;
        (g.attributes.aSize.array as Float32Array)[i] = sz;
        g.attributes.aStart.needsUpdate = true;
        g.attributes.aVel.needsUpdate = true;
        g.attributes.aBirth.needsUpdate = true;
        g.attributes.aLife.needsUpdate = true;
        g.attributes.aSize.needsUpdate = true;
      },
    }),
    [points, mat],
  );
  return [points, handle];
}
