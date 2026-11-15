// Moon surface, starfield background, Sun glow and engine plume.
// Original code, inspired by common Shadertoy techniques.

import { fragmentDepth, fragmentHead, noiseGLSL, vertexHead, vertexTail } from "./common";

export const moonFragment = /* glsl */ `
${fragmentHead}
uniform vec3 uSunDir;
varying vec3 vObjPos;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
${noiseGLSL}

float craters(vec3 p) {
  float d = cellDist(p);
  float floorDark = smoothstep(0.32, 0.18, d) * 0.35;
  float rim = smoothstep(0.26, 0.33, d) * smoothstep(0.42, 0.33, d) * 0.45;
  return rim - floorDark;
}

void main() {
  vec3 p = normalize(vObjPos);
  // Dark maria and bright highlands.
  float maria = smoothstep(0.48, 0.58, fbm(p * 1.6 + 3.0, 5));
  float base = mix(0.36, 0.17, maria);
  float c = craters(p * 6.0) * 0.6 + craters(p * 14.0) * 0.35 + craters(p * 32.0) * 0.2;
  float grain = fbm(p * 40.0, 4);
  float albedo = base + c * 0.25 + (grain - 0.5) * 0.08;
  vec3 col = vec3(albedo) * vec3(1.0, 0.97, 0.93);

  vec3 N = normalize(vWorldNormal);
  vec3 L = normalize(uSunDir);
  float ndl = max(dot(N, L), 0.0);
  // The Moon looks flat when full: lighten the limb a little (simple Lommel-Seeliger style).
  vec3 V = normalize(cameraPosition - vWorldPos);
  float ndv = max(dot(N, V), 0.0);
  float ls = ndl / (ndl + ndv + 1e-4) * 2.0;
  gl_FragColor = vec4(col * mix(ndl, ls, 0.6) * 2.2, 1.0);
  ${fragmentDepth}
}
`;

export const starsVertex = /* glsl */ `
${vertexHead}
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
  ${vertexTail}
}
`;

export const starsFragment = /* glsl */ `
${fragmentHead}
uniform float uTime;
varying vec3 vDir;
${noiseGLSL}

vec3 starLayer(vec3 d, float scale, float density, float seed) {
  vec3 p = d * scale + seed;
  vec3 cell = floor(p);
  vec3 f = fract(p);
  float h = hash13(cell);
  if (h < 1.0 - density) return vec3(0.0);
  vec3 center = 0.25 + 0.5 * hash33(cell + seed);
  float dist = length(f - center);
  // Keep stars about a pixel wide whatever the zoom, to avoid shimmering.
  float px = length(fwidth(p));
  float size = max(0.035, px * 0.8);
  float b = exp(-dist * dist / (size * size));
  float mag = pow(hash13(cell + 7.0), 6.0) * 3.0 + 0.15;
  float twinkle = 0.85 + 0.15 * sin(uTime * (1.5 + 3.0 * h) + h * 100.0);
  // Colour from cool blue-white to warm orange.
  float temp = hash13(cell + 3.0);
  vec3 tint = mix(vec3(1.0, 0.75, 0.5), vec3(0.75, 0.85, 1.0), temp);
  return tint * b * mag * twinkle;
}

void main() {
  vec3 d = normalize(vDir);

  // Galactic plane, tilted against the scene.
  vec3 galN = normalize(vec3(0.3, 0.9, 0.35));
  float g = dot(d, galN);
  float band = exp(-pow(g / 0.16, 2.0));
  float core = exp(-pow(g / 0.06, 2.0)) * smoothstep(0.2, 1.0, dot(d, normalize(vec3(-0.8, 0.25, -0.5))));

  vec3 col = vec3(0.0);
  col += starLayer(d, 90.0, 0.05 + 0.10 * band, 0.0);
  col += starLayer(d, 180.0, 0.04 + 0.2 * band, 17.0) * 0.5;
  col += starLayer(d, 360.0, 0.02 + 0.35 * band, 41.0) * 0.35;

  float clouds = fbm(d * 6.0, 6);
  float dust = smoothstep(0.45, 0.7, fbm(d * 9.0 + 5.0, 5));
  vec3 milky = vec3(0.55, 0.6, 0.8) * band * clouds * 0.035;
  milky += vec3(0.9, 0.75, 0.55) * core * clouds * 0.06;
  milky *= 1.0 - dust * 0.8 * band;
  col += milky;

  gl_FragColor = vec4(col, 1.0);
  ${fragmentDepth}
}
`;

export const billboardVertex = /* glsl */ `
${vertexHead}
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  ${vertexTail}
}
`;

export const sunGlowFragment = /* glsl */ `
${fragmentHead}
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float disc = smoothstep(0.06, 0.05, r) * 40.0;
  float halo = exp(-r * 9.0) * 3.0 + exp(-r * 3.0) * 0.25;
  // Faint diffraction spikes.
  float spikes = (exp(-abs(p.x) * 120.0) + exp(-abs(p.y) * 120.0)) * exp(-r * 4.0) * 0.6;
  vec3 col = vec3(1.0, 0.95, 0.88) * (disc + halo + spikes);
  float a = clamp(disc + halo + spikes, 0.0, 1.0) * (1.0 - smoothstep(0.85, 1.0, r));
  gl_FragColor = vec4(col * a, a);
  ${fragmentDepth}
}
`;

export const plumeFragment = /* glsl */ `
${fragmentHead}
uniform float uTime;
uniform float uThrottle;
varying vec2 vUv;
${noiseGLSL}
void main() {
  // vUv.y runs from the nozzle (1) to the tail (0) on a cone.
  // Clamp: rounding can push vUv.y slightly below 0, and pow() of a negative is NaN,
  // which bloom would then smear across the whole screen.
  float along = clamp(vUv.y, 0.0, 1.0);
  float flicker = 0.75 + 0.25 * valueNoise(vec3(vUv * vec2(6.0, 10.0), uTime * 25.0));
  float core = pow(along, 2.5);
  vec3 col = mix(vec3(1.0, 0.45, 0.15), vec3(0.7, 0.85, 1.0), core) * (core * 6.0 + along * 1.5) * flicker;
  float a = along * clamp(uThrottle, 0.0, 1.0);
  gl_FragColor = vec4(max(col * a, 0.0), a);
  ${fragmentDepth}
}
`;
