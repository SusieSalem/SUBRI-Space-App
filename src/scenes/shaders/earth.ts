// Procedural Earth: continents, oceans with sun glint, ice caps, city lights on
// the night side, and a soft terminator. Original code, inspired by common
// Shadertoy planet techniques. Can be swapped for NASA Blue Marble / Black
// Marble textures later without changing the lighting model.

import { fragmentDepth, fragmentHead, noiseGLSL, sphereVertex } from "./common";

export const earthVertex = sphereVertex;

export const earthFragment = /* glsl */ `
${fragmentHead}
uniform vec3 uSunDir;
varying vec3 vObjPos;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
${noiseGLSL}

void main() {
  vec3 p = normalize(vObjPos);
  float lat = abs(p.y);

  // Height field: domain-warped fBm gives continent-like shapes.
  vec3 warp = vec3(fbm(p * 1.3 + 4.0, 4), fbm(p * 1.3 + 9.0, 4), fbm(p * 1.3 + 2.0, 4));
  float h = fbm(p * 1.8 + warp * 1.2, 7);
  float land = smoothstep(0.515, 0.53, h);
  float detail = fbm(p * 14.0, 5);

  // Oceans: darker in the deep, lighter on shelves near the coast.
  vec3 deep = vec3(0.004, 0.02, 0.06);
  vec3 shelf = vec3(0.01, 0.07, 0.13);
  vec3 ocean = mix(deep, shelf, smoothstep(0.42, 0.515, h));

  // Land: forest, desert belt near the tropics, rock in the highlands.
  vec3 forest = vec3(0.04, 0.09, 0.03);
  vec3 grass = vec3(0.10, 0.13, 0.05);
  vec3 desert = vec3(0.36, 0.28, 0.17);
  vec3 rock = vec3(0.16, 0.14, 0.12);
  float dryBelt = smoothstep(0.12, 0.25, lat) * (1.0 - smoothstep(0.38, 0.5, lat));
  float dry = smoothstep(0.45, 0.6, fbm(p * 3.0 + 7.0, 5)) * (0.4 + dryBelt);
  vec3 landCol = mix(mix(forest, grass, detail), desert, clamp(dry, 0.0, 1.0));
  landCol = mix(landCol, rock, smoothstep(0.6, 0.7, h));
  landCol *= 0.75 + 0.5 * detail;

  float ice = smoothstep(0.80, 0.86, lat + 0.06 * (detail - 0.5));
  vec3 albedo = mix(ocean, landCol, land);
  albedo = mix(albedo, vec3(0.75, 0.8, 0.85), ice);

  vec3 N = normalize(vWorldNormal);
  vec3 L = normalize(uSunDir);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float ndl = dot(N, L);

  // Soft terminator instead of a hard cut.
  float day = smoothstep(-0.08, 0.25, ndl);
  vec3 col = albedo * max(ndl, 0.0) * 3.2 + albedo * 0.015 * day;

  // Sun glint on water (Blinn-Phong plus a little fresnel).
  vec3 H = normalize(L + V);
  float water = (1.0 - land) * (1.0 - ice);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  float glint = pow(max(dot(N, H), 0.0), 400.0) * 3.0 + pow(max(dot(N, H), 0.0), 40.0) * 0.08;
  col += vec3(1.0, 0.86, 0.66) * glint * water * day * (0.4 + fres);

  // City lights on the night side.
  float night = 1.0 - smoothstep(-0.15, 0.05, ndl);
  float clusters = smoothstep(0.5, 0.62, fbm(p * 5.0 + 11.0, 4));
  float dots = smoothstep(0.62, 0.85, fbm(p * 60.0, 3));
  float coast = 1.0 - smoothstep(0.53, 0.6, h);
  float cities = land * (1.0 - ice) * clusters * dots * (0.6 + 0.8 * coast);
  col += vec3(1.0, 0.6, 0.25) * cities * night * 1.4;

  gl_FragColor = vec4(col, 1.0);
  ${fragmentDepth}
}
`;

export const cloudFragment = /* glsl */ `
${fragmentHead}
uniform vec3 uSunDir;
uniform float uTime;
varying vec3 vObjPos;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
${noiseGLSL}

void main() {
  vec3 p = normalize(vObjPos);
  float drift = uTime * 0.004;
  vec3 q = p * 2.5 + vec3(drift, 0.0, -drift);
  // Domain warp gives swirling, storm-like shapes.
  vec3 w = vec3(fbm(q + 1.3, 4), fbm(q + 7.1, 4), fbm(q + 3.7, 4));
  float c = fbm(q * 1.6 + w * 2.0, 6);
  // Fewer clouds in the dry subtropics, more along the equator and mid-latitudes.
  float lat = abs(p.y);
  float band = 0.9 - 0.25 * smoothstep(0.15, 0.3, lat) * (1.0 - smoothstep(0.35, 0.55, lat));
  float cover = smoothstep(0.52, 0.8, c * band + 0.05);

  vec3 N = normalize(vWorldNormal);
  float ndl = dot(N, normalize(uSunDir));
  float lit = max(ndl, 0.0) * 1.6 + 0.004;
  vec3 col = vec3(1.0) * lit;
  // Clouds near the terminator catch warm light.
  col *= mix(vec3(1.0, 0.55, 0.3), vec3(1.0), smoothstep(-0.05, 0.25, ndl));

  gl_FragColor = vec4(col, cover * 0.92);
  ${fragmentDepth}
}
`;
