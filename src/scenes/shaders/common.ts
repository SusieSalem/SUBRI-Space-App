// Shared GLSL helpers. Written from scratch for this project, inspired by
// common Shadertoy techniques (hash-based value noise, fBm, cell noise).
// No third-party shader code is copied here.

export const noiseGLSL = /* glsl */ `
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

float valueNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i + vec3(0, 0, 0)), hash13(i + vec3(1, 0, 0)), f.x),
        mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
        mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

float fbm(vec3 p, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    sum += amp * valueNoise(p);
    p = p * 2.02 + vec3(1.7, 9.2, 3.1);
    amp *= 0.5;
  }
  return sum;
}

// Distance to the nearest random feature point (used for craters).
float cellDist(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float d = 8.0;
  for (int x = -1; x <= 1; x++)
  for (int y = -1; y <= 1; y++)
  for (int z = -1; z <= 1; z++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 r = g + hash33(i + g) - f;
    d = min(d, dot(r, r));
  }
  return sqrt(d);
}
`;

// Logarithmic depth buffer support for custom ShaderMaterials.
export const vertexHead = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
`;
export const vertexTail = /* glsl */ `
#include <logdepthbuf_vertex>
`;
export const fragmentHead = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
`;
export const fragmentDepth = /* glsl */ `
#include <logdepthbuf_fragment>
`;

/** Standard vertex shader that passes object position, world position and world normal. */
export const sphereVertex = /* glsl */ `
${vertexHead}
varying vec3 vObjPos;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
void main() {
  vObjPos = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
  ${vertexTail}
}
`;
