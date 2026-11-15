// The whole world beyond the rocket, drawn per pixel on a sphere around the
// camera: the Earth (oceans, continents, the coast at the launch site, clouds,
// city lights), its atmosphere (Rayleigh + Mie + Ozone Chappuis scattering),
// the Moon, the Sun and the stars. Everything is analytic ray casting at real
// scale, so the view changes continuously from the pad to lunar distance with
// no switch.
//
// Upgraded with physical rendering techniques:
// 1. Atmosphere: 3-component density (Rayleigh, Mie, and 35km Ozone Chappuis
//    distribution), analytic step transmittance integration, dithered ray
//    marching, multi-scattering ambient approximation, and lunar transit dimming.
// 2. Ocean waves & reflections:
//    3-octave golden-angle heightmap with quintic smooth noise, non-linear finite
//    difference normals, volumetric RGB water absorption & wide turquoise shelf,
//    seabed caustics, roughness-aware Schlick Fresnel, GGX sun specular, and sky/cloud reflections.
// 3. Clouds: analytical 2D curl-noise high-altitude cirrus layer (~9.5 km) +
//    dual-octave multi-scattering cumulus with Beer-Powder.

import { R_EARTH, R_MOON } from "../../core/orbit";
import { fragmentDepth, fragmentHead, noiseGLSL, vertexHead, vertexTail } from "./common";

export const planetVertex = /* glsl */ `
${vertexHead}
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
  ${vertexTail}
}
`;

export const planetFragment = /* glsl */ `
${fragmentHead}
uniform mat3 uWorldToEci;
uniform vec3 uSunDir;       // ECI
uniform vec3 uCamUp;        // ECI, radial direction at the camera
uniform float uCamAlt;      // metres
uniform vec3 uCamFromPad;   // ECI, camera minus pad (metres)
uniform vec3 uPadEast;
uniform vec3 uPadNorth;
uniform vec3 uMoonRel;      // ECI, Moon centre minus camera (metres)
uniform float uEarthAngle;  // Earth rotation angle, radians
uniform float uTime;      // mission time (clouds drift with time warp)
uniform float uRealTime;  // wall-clock time (waves keep moving on the pad)
uniform float uSunIntensity;
varying vec3 vDir;

#ifndef VIEW_STEPS
#define VIEW_STEPS 6
#endif
#ifndef LIGHT_STEPS
#define LIGHT_STEPS 2
#endif
#ifndef CLOUD_STEPS
#define CLOUD_STEPS 8
#endif
#ifndef CLOUD_LIGHT
#define CLOUD_LIGHT 2
#endif
#ifndef WATER_OCTAVES
#define WATER_OCTAVES 3
#endif
#ifndef WATER_HQ
#define WATER_HQ 1
#endif

const float R = ${R_EARTH.toFixed(1)};
const float RM = ${R_MOON.toFixed(1)};
const float HA = 100000.0;
const float HR = 8000.0;
const float HM = 1200.0;
const vec3 BETA_R = vec3(5.8e-6, 13.5e-6, 33.1e-6);
const float BETA_M = 16e-6;
// Ozone Chappuis band absorption cross-section * peak number density
const vec3 BETA_O = vec3(1.80e-6, 1.31e-6, 0.08e-6);
const float G = 0.8;
const float CB = 1500.0;       // cumulus base (m)
const float CT = 4200.0;       // cumulus tops (m)
const float CIRRUS_H = 9500.0; // high-altitude cirrus sheet (m)

${noiseGLSL}

// 2D hash and analytical Perlin gradient for curl-noise cirrus
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

vec2 normHash2(vec2 p) {
  return normalize(hash22(p) - 0.5 + vec2(1e-4));
}

vec2 perlinGrad2D(vec2 coord) {
  vec2 i = floor(coord);
  vec2 f = fract(coord);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  vec2 g0 = normHash2(i);
  vec2 g1 = normHash2(i + vec2(1.0, 0.0));
  vec2 g2 = normHash2(i + vec2(0.0, 1.0));
  vec2 g3 = normHash2(i + vec2(1.0, 1.0));
  float v0 = dot(g0, f);
  float v1 = dot(g1, f - vec2(1.0, 0.0));
  float v2 = dot(g2, f - vec2(0.0, 1.0));
  float v3 = dot(g3, f - vec2(1.0, 1.0));
  vec2 omu = 1.0 - u;
  return vec2(
    ((v1 - v0) * omu.y + (v3 - v2) * u.y) * du.x,
    ((v2 - v0) * omu.x + (v3 - v1) * u.x) * du.y
  );
}

vec2 curl2D(vec2 coord) {
  vec2 g = perlinGrad2D(coord);
  return vec2(g.y, -g.x);
}

vec2 raySphereH(float h, float mu, float H) {
  float r = R + h;
  float b = r * mu;
  float c = (h - H) * (2.0 * R + h + H);
  float disc = b * b - c;
  if (disc < 0.0) return vec2(1e30, -1e30);
  float s = sqrt(disc);
  float far = -b + s;
  float near = -b - s;
  if (b < 0.0) near = c / (-b + s);
  return vec2(near, far);
}

float heightAt(float h, float mu, float t) {
  float x = h * (2.0 * R + h) + 2.0 * (R + h) * mu * t + t * t;
  float r = sqrt(R * R + x);
  return x / (r + R);
}

// 3-component atmospheric density: Rayleigh, Mie, and 35km Ozone layer
vec3 skyDensity(float h) {
  vec2 rm = exp(-max(h, 0.0) / vec2(HR, HM));
  float ozone = exp(-max(0.0, 35000.0 - h) * (1.0 / 5000.0))
              * exp(-max(0.0, h - 35000.0) * (1.0 / 15000.0));
  return vec3(rm, ozone);
}

vec3 sunDepth(float h, float muS) {
  vec2 ground = raySphereH(h, muS, 0.0);
  if (ground.x < ground.y && ground.x > 0.0) return vec3(1e9);
  float len = raySphereH(h, muS, HA).y;
  if (len <= 0.0) return vec3(0.0);
  float dl = len / float(LIGHT_STEPS);
  vec3 od = vec3(0.0);
  for (int j = 0; j < LIGHT_STEPS; j++) {
    float hj = max(heightAt(h, muS, (float(j) + 0.5) * dl), 0.0);
    od += skyDensity(hj) * dl;
  }
  return od;
}

vec3 extinction(vec3 od) {
  return exp(-(BETA_R * od.x + BETA_M * 1.1 * od.y + BETA_O * od.z));
}

vec3 toEcef(vec3 p) {
  float c = cos(uEarthAngle);
  float s = sin(uEarthAngle);
  return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
}

// Large-scale continents on the Earth-fixed sphere. The launch site (ECEF +Y)
// is kept on a coast with land to the west.
float landMask(vec3 n, out float height) {
  vec3 warp = vec3(fbm(n * 1.3 + 4.0, 4), fbm(n * 1.3 + 9.0, 4), fbm(n * 1.3 + 2.0, 4));
  height = fbm(n * 1.8 + warp * 1.2, 6);
  float land = smoothstep(0.515, 0.53, height);
  float nearPad = 1.0 - smoothstep(0.02, 0.09, length(n - vec3(-0.035, 1.0, 0.0)));
  return max(land, nearPad);
}

vec3 globalAlbedo(vec3 n, out float water, out float height) {
  float land = landMask(n, height);
  water = 1.0 - land;
  float lat = abs(n.z);
  float detail = fbm(n * 14.0, 4);
  vec3 deep = vec3(0.004, 0.02, 0.06);
  vec3 shelf = vec3(0.01, 0.07, 0.13);
  vec3 ocean = mix(deep, shelf, smoothstep(0.42, 0.515, height));
  vec3 forest = vec3(0.04, 0.09, 0.03);
  vec3 grass = vec3(0.10, 0.13, 0.05);
  vec3 desert = vec3(0.36, 0.28, 0.17);
  float dryBelt = smoothstep(0.12, 0.25, lat) * (1.0 - smoothstep(0.38, 0.5, lat));
  float dry = smoothstep(0.45, 0.6, fbm(n * 3.0 + 7.0, 4)) * (0.4 + dryBelt);
  vec3 landCol = mix(mix(forest, grass, detail), desert, clamp(dry, 0.0, 1.0));
  landCol *= 0.75 + 0.5 * detail;
  float ice = smoothstep(0.80, 0.86, lat + 0.06 * (detail - 0.5));
  vec3 col = mix(ocean, landCol, land);
  water *= 1.0 - ice;
  return mix(col, vec3(0.75, 0.8, 0.85), ice);
}

// Fine detail near the pad: scrub, beach and the ocean to the east.
vec3 nearAlbedo(vec2 p, float dist, out float water, out float coastDist) {
  float curve = (fbm(vec3(p.y / 4500.0, 0.0, 3.0), 4) - 0.5) * 900.0
              + (fbm(vec3(p.y / 900.0, 0.0, 7.0), 3) - 0.5) * 180.0;
  float coastX = 1150.0 + curve;
  float coast = p.x - coastX;
  coastDist = coast;
  water = smoothstep(-8.0, 8.0, coast);
  float big = fbm(vec3(p / 2200.0, 1.0), 4);
  float small = fbm(vec3(p / 180.0, 2.0), 3);
  vec3 scrub = vec3(0.055, 0.085, 0.032);
  vec3 grass = vec3(0.085, 0.115, 0.042);
  vec3 dry = vec3(0.14, 0.125, 0.08);
  vec3 land = mix(mix(scrub, grass, smoothstep(0.4, 0.6, big)), dry, smoothstep(0.55, 0.75, small) * 0.5);
  land = mix(land, mix(scrub, grass, 0.5), smoothstep(3000.0, 15000.0, dist) * 0.6);
  vec3 sand = vec3(0.28, 0.25, 0.19);
  land = mix(land, sand, 1.0 - smoothstep(0.0, 45.0, abs(coast + 20.0)));
  vec3 sea = mix(vec3(0.005, 0.022, 0.048), vec3(0.008, 0.038, 0.065), 1.0 - smoothstep(0.0, 900.0, coast));
  return mix(land, sea, water);
}

// Large-scale weather: where the cloud systems are, 0..1.
float weatherCover(vec3 nf, float padDist) {
  vec3 q = nf * 5.0 + vec3(uTime * 0.00002, 0.0, 0.0);
  float c = fbm(q + fbm(q * 2.0 + 3.1, 3) * 1.2, 4);
  float cover = smoothstep(0.42, 0.68, c);
  return mix(cover, 0.33, 1.0 - smoothstep(20000.0, 140000.0, padDist));
}

// Cloud density at an Earth-fixed point pk (km) and height h (m).
float cloudDensity(vec3 pk, float h, float cover) {
  float hf = clamp((h - CB) / (CT - CB), 0.0, 1.0);
  float profile = smoothstep(0.0, 0.07, hf) * (1.0 - smoothstep(0.3, 1.0, hf));
  vec3 q = pk + vec3(uTime * 0.008, 0.0, uTime * 0.003);
  float shape = fbm(q * 0.38, 4);
  float d = shape * profile - (1.0 - cover) * 0.72;
  if (d <= 0.0) return 0.0;
  d -= (fbm(q * 2.4 + 7.0, 2) - 0.5) * 0.1;
  return clamp(d * 3.5, 0.0, 1.0);
}

float hg(float g, float c) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * c, 1.5));
}

// Where the ray is inside the cloud slab, or (-1, -1).
vec2 cloudSegment(float h0, float mu, float tLimit) {
  vec2 b = raySphereH(h0, mu, CB);
  vec2 tp = raySphereH(h0, mu, CT);
  float s;
  float e;
  if (h0 < CB) {
    if (b.y <= 0.0) return vec2(-1.0);
    s = b.y;
    e = tp.y;
  } else if (h0 < CT) {
    s = 0.0;
    e = (b.x < b.y && b.x > 0.0) ? b.x : tp.y;
  } else {
    if (!(tp.x < tp.y) || tp.y <= 0.0) return vec2(-1.0);
    s = max(tp.x, 0.0);
    e = (b.x < b.y && b.x > 0.0) ? b.x : tp.y;
  }
  e = min(e, min(tLimit, s + 160000.0));
  if (e <= s) return vec2(-1.0);
  return vec2(s, e);
}

// Ray-marched cumulus with dual-octave multi-scattering & Beer-Powder.
vec4 marchClouds(vec3 up, float h0, float mu, vec3 d, vec3 L, vec2 seg, float transitFactor) {
  float span = seg.y - seg.x;
  float tMid = seg.x + span * 0.3;
  vec3 nMid = normalize(up * (R + h0) + d * tMid);
  float cover = weatherCover(toEcef(nMid), length(uCamFromPad + d * tMid));
  if (cover < 0.04) return vec4(0.0, 0.0, 0.0, 1.0);

  float muS = dot(nMid, L);
  vec3 sunCol = uSunIntensity * transitFactor * extinction(sunDepth(2500.0, muS)) * step(-0.08, muS);
  vec3 ambient = uSunIntensity * transitFactor * vec3(0.04, 0.065, 0.105) * (0.015 + 0.985 * smoothstep(-0.14, 0.3, muS));
  float cosT = dot(d, L);
  float phase = mix(hg(0.72, cosT), hg(-0.28, cosT), 0.32) * 2.8;
  float phaseMulti = mix(hg(0.35, cosT), 1.0 / (4.0 * PI), 0.5) * 1.6;
  vec3 Lf = toEcef(L);
  float jitter = hash13(vec3(gl_FragCoord.xy, 3.7));

  float T = 1.0;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < CLOUD_STEPS; i++) {
    float u = (float(i) + jitter) / float(CLOUD_STEPS);
    float t = seg.x + span * u * u;
    float ds = span * 2.0 * max(u, 0.5 / float(CLOUD_STEPS)) / float(CLOUD_STEPS);
    float h = heightAt(h0, mu, t);
    vec3 n = normalize(up * (R + h0) + d * t);
    vec3 pk = toEcef(n) * ((R + h) / 1000.0);
    float dens = cloudDensity(pk, h, cover);
    if (dens <= 0.0) continue;
    float odL = 0.0;
    #if CLOUD_LIGHT > 0
    for (int j = 0; j < CLOUD_LIGHT; j++) {
      float dist = j == 0 ? 220.0 : 800.0;
      odL += cloudDensity(pk + Lf * (dist / 1000.0), h + dot(n, L) * dist, cover) * (j == 0 ? 220.0 : 580.0);
    }
    #else
    odL = dens * 280.0 * clamp(1.0 - (h - CB) / (CT - CB), 0.15, 1.0);
    #endif
    float sigma = 0.01;
    float Tl1 = exp(-odL * sigma);
    float Tl2 = exp(-odL * sigma * 0.25) * 0.38;
    float powder = 1.0 - exp(-dens * sigma * 420.0);
    float hf = clamp((h - CB) / (CT - CB), 0.0, 1.0);
    vec3 directLight = sunCol * (Tl1 * phase + Tl2 * phaseMulti) * (0.32 + 0.68 * powder);
    vec3 S = directLight + ambient * (0.50 + 0.50 * hf);
    float stepT = exp(-dens * sigma * ds);
    acc += T * S * (1.0 - stepT);
    T *= stepT;
    if (T < 0.02) break;
  }
  return vec4(acc, T);
}

// Analytical 2D Curl-Noise Cirrus layer at 9.5 km.
vec4 sampleCirrus(vec3 up, float h0, float mu, vec3 d, vec3 L, float tLimit, float transitFactor) {
  vec2 hit = raySphereH(h0, mu, CIRRUS_H);
  float t = (h0 < CIRRUS_H) ? hit.y : hit.x;
  if (t <= 0.0 || t >= tLimit || t > 260000.0) return vec4(0.0, 0.0, 0.0, 1.0);

  vec3 n = normalize(up * (R + h0) + d * t);
  vec3 nf = toEcef(n);
  vec2 coord = nf.xy * 6371.0 + vec2(uTime * 0.012, uTime * 0.004);
  vec2 curl = curl2D(coord * 0.018) * 0.5
            + curl2D(coord * 0.045) * 0.25;
  vec2 warped = coord * 0.022 + curl * 1.25;

  float macro = fbm(vec3(nf * 7.5 + vec3(uTime * 0.000015, 0.0, 0.0)), 3);
  float streaks = fbm(vec3(warped, nf.z * 4.0), 3);
  float wisps = smoothstep(0.46, 0.76, macro) * smoothstep(0.44, 0.78, streaks);
  float dens = wisps * 0.38 * (1.0 - smoothstep(140000.0, 260000.0, t));
  if (dens <= 0.002) return vec4(0.0, 0.0, 0.0, 1.0);

  float muS = dot(n, L);
  vec3 sunCol = uSunIntensity * transitFactor * extinction(sunDepth(CIRRUS_H, muS)) * smoothstep(-0.10, 0.02, muS);
  vec3 amb = uSunIntensity * transitFactor * vec3(0.04, 0.06, 0.10) * smoothstep(-0.15, 0.25, muS);
  float cosT = dot(d, L);
  float phase = mix(hg(0.68, cosT), hg(-0.2, cosT), 0.3) * 2.4;
  float viewCos = max(abs(dot(n, d)), 0.15);
  float alpha = 1.0 - exp(-dens / viewCos);
  vec3 col = (sunCol * phase * (1.0 - 0.35 * dens) + amb) * alpha;
  return vec4(col, 1.0 - alpha);
}

/* ============================================================================
 * WATER SHADER — Multi-octave ocean heightmap, volumetric absorption & GGX
 * ============================================================================ */

// Quintic-smoothed 2D noise keeping wave wavelengths at 12m - 48m
// matching wave_size[i] so there is zero sub-pixel sparkle/aliasing.
float smoothNoise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0); // C2 quintic interpolation
  float a = hash13(vec3(i, 1.3));
  float b = hash13(vec3(i + vec2(1.0, 0.0), 1.3));
  float c = hash13(vec3(i + vec2(0.0, 1.0), 1.3));
  float d = hash13(vec3(i + vec2(1.0, 1.0), 1.3));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float waveNoise2D(vec2 uv) {
  #if WATER_HQ > 0
  return smoothNoise2D(uv * 2.2) * 0.70 + smoothNoise2D(uv * 4.5 + vec2(7.3, 13.1)) * 0.30;
  #else
  return smoothNoise2D(uv * 2.4);
  #endif
}

const float WAVE_RADIANCE = 2.39996;

vec2 getWaveSize(int i) {
  if (i == 0) return vec2(48.0, 12.0);
  if (i == 1) return vec2(12.0, 48.0);
  return vec2(32.0, 32.0);
}

float getWaterHeightmap(vec2 posxz, float largeWaves, float largeWavesCurved, float time) {
  float waveSpeed = 1.0;
  float waveScale = 1.0;
  float waveHeight = 1.0;

  vec2 pos = posxz;
  float movement = time * 0.22 * waveSpeed;

  float c = cos(WAVE_RADIANCE);
  float s = sin(WAVE_RADIANCE);
  mat2 rotationMatrix = mat2(c, s, -s, c);

  float heightSum = 0.0;
  for (int i = 0; i < WATER_OCTAVES; i++) {
    pos = rotationMatrix * pos;
    vec2 wSize = getWaveSize(i) * waveScale;
    float noiseVal = waveNoise2D(pos / wSize + largeWavesCurved * 0.5 + movement);
    heightSum += noiseVal;
  }

  return (heightSum / (float(WATER_OCTAVES) * 1.5)) * max(largeWavesCurved, 0.3) * waveHeight;
}

float waterCaustics(vec3 worldPos, vec3 sunVec, float surfaceDepthDist, float time) {
  vec3 projectedPos = worldPos - (sunVec / max(abs(sunVec.y), 0.001)) * surfaceDepthDist;
  vec2 pos = projectedPos.xz;

  float movement = time * 0.22;
  float c = cos(WAVE_RADIANCE);
  float s = sin(WAVE_RADIANCE);
  mat2 rotationMatrix = mat2(c, s, -s, c);

  float largeWaves = waveNoise2D(pos / 600.0);
  float largeWavesCurved = pow(1.0 - pow(1.0 - largeWaves, 2.5), 4.5);

  float heightSum = 0.0;
  for (int i = 0; i < 3; i++) {
    pos = rotationMatrix * pos;
    float noiseSample = waveNoise2D(pos / getWaveSize(i) + largeWavesCurved * 0.5 + movement);
    float sharp = abs(abs(noiseSample * 2.0 - 1.0) * 2.0 - 1.0);
    heightSum += pow(sharp, 1.0 + largeWavesCurved);
  }

  return exp((1.0 + 5.0 * sqrt(largeWavesCurved)) * (heightSum / 3.0 - 0.5));
}

float shlickFresnelRoughness(float VdotN, float roughness) {
  float shlickFresnel = clamp(1.0 - VdotN, 0.0, 1.0);
  float curves = exp(-4.0 * pow(1.0 - roughness, 2.5));
  float brightness = exp(-3.0 * pow(1.0 - sqrt(roughness), 3.50));
  shlickFresnel = pow(1.0 - pow(1.0 - shlickFresnel, mix(1.0, 1.9, curves)), mix(5.0, 2.6, curves));
  shlickFresnel = mix(0.0, mix(1.0, 0.065, brightness), clamp(shlickFresnel, 0.0, 1.0));
  return shlickFresnel;
}

vec3 waterGGX(vec3 n, vec3 v, vec3 l, float roughness, vec3 f0) {
  float r = max(pow(roughness, 2.5), 0.0001);
  vec3 h = normalize(l + v);
  float dotLH = clamp(dot(h, l), 0.0, 1.0);
  float dotNH = clamp(dot(n, h), 0.0, 1.0);
  float dotNL = clamp(dot(n, l), 0.0, 1.0);
  float dotNHsq = dotNH * dotNH;

  float denom = dotNHsq * r - dotNHsq + 1.0;
  float D = r / (3.141592653589793 * denom * denom);

  vec3 F = f0 + (1.0 - f0) * exp2((-5.55473 * dotLH - 6.98316) * dotLH);
  float k2 = 0.25 * r;

  return (dotNL * D * F) / max(dotLH * dotLH * (1.0 - k2) + k2, 1e-5);
}

vec3 getWaterSunColor(vec3 sunDir) {
  float elev = sunDir.y;
  float sunsetFactor = clamp(1.0 - abs(elev) * 3.5, 0.0, 1.0);
  vec3 middaySun = vec3(1.5, 1.4, 1.25);
  vec3 sunsetSun = vec3(1.85, 0.65, 0.2);
  vec3 duskSun   = vec3(0.4, 0.15, 0.08);
  vec3 col = mix(middaySun, sunsetSun, sunsetFactor);
  if (elev < 0.0) col = mix(sunsetSun, duskSun, clamp(-elev * 5.0, 0.0, 1.0));
  return col;
}

vec3 sampleWaterSkyReflection(vec3 reflectDir, vec3 sunVec, float transitFactor) {
  vec3 rDir = normalize(vec3(reflectDir.x, max(reflectDir.y, 0.01), reflectDir.z));
  float muR = max(rDir.y, 0.02);
  float len = raySphereH(0.0, muR, HA).y;
  vec3 sumR = vec3(0.0);
  vec3 sumM = vec3(0.0);
  vec3 trans = vec3(1.0);
  float ds = len / 4.0;
  for (int i = 0; i < 4; i++) {
    float t = (float(i) + 0.4) * ds;
    float h = max(heightAt(0.0, muR, t), 0.0);
    vec3 dens = skyDensity(h);
    vec3 airmass = dens * ds;
    vec3 stepOD = BETA_R * airmass.x + BETA_M * 1.1 * airmass.y + BETA_O * airmass.z;
    vec3 stepT = exp(-stepOD);
    vec3 stepVis = trans * clamp((1.0 - stepT) / max(stepOD, vec3(1e-6)), 0.0, 1.0);
    vec3 sunTrans = extinction(sunDepth(h, max(sunVec.y, 0.02)));
    sumR += stepVis * sunTrans * airmass.x;
    sumM += stepVis * sunTrans * airmass.y;
    trans *= stepT;
  }
  float nu = dot(rDir, sunVec);
  float phaseR = 3.0 / (16.0 * PI) * (1.0 + nu * nu);
  float g2 = G * G;
  float phaseM = 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + nu * nu)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * G * nu, 1.5));
  return (sumR * BETA_R * phaseR + sumM * BETA_M * phaseM) * uSunIntensity * transitFactor;
}

vec3 shadeWater(vec3 n, vec3 d, vec3 L, vec3 sunT, float shadow, float dist, vec2 local, float coastDist, float nearW, float h0, float transitFactor) {
  vec3 east = uPadEast - n * dot(n, uPadEast);
  float eastLen = length(east);
  east = eastLen > 1e-3 ? east / eastLen : normalize(cross(vec3(0.0, 0.0, 1.0), n));
  vec3 north = cross(n, east);

  // Tangent-space vectors (x = East, y = Up, z = North)
  vec3 viewDir = normalize(vec3(dot(-d, east), max(dot(-d, n), 0.015), dot(-d, north)));
  vec3 sunVec  = normalize(vec3(dot(L, east), dot(L, n), dot(L, north)));
  float dayVis = smoothstep(-0.12, 0.08, sunVec.y) * transitFactor;

  if (nearW > 0.001) {
    vec3 _WaterColor = vec3(0.1, 0.4, 0.6);
    float _DepthDistance = 5.0;
    float _WaveHeight = 1.65;
    float _Smoothness = 0.94;
    float _ReflectionStrength = 0.15;
    float _FresnelPower = 1.0;
    float _CausticsBrightness = 1.5;
    float _CausticsPower = 1.0;

    // World position on the ocean surface (smooth large swells readable from pad)
    vec2 worldXZ = local * 0.42;
    float time = uRealTime;

    // 1. Calculate Water Normals
    float largeWaves = waveNoise2D(worldXZ / 600.0);
    float largeWavesCurved = pow(1.0 - pow(1.0 - largeWaves, 2.5), 4.5);

    float deltaPos = mix(1.0 / 3.0, 0.15, largeWavesCurved);

    float base_h0 = getWaterHeightmap(worldXZ, largeWaves, largeWavesCurved, time);
    float base_h1 = getWaterHeightmap(worldXZ + vec2(deltaPos, 0.0), largeWaves, largeWavesCurved, time);
    float base_h3 = getWaterHeightmap(worldXZ + vec2(0.0, deltaPos), largeWaves, largeWavesCurved, time);

    float wh0 = base_h0 * _WaveHeight;
    float wh1 = base_h1 * _WaveHeight;
    float wh3 = base_h3 * _WaveHeight;

    float xDelta = (wh1 - wh0) / deltaPos;
    float yDelta = (wh3 - wh0) / deltaPos;

    // Smooth normal attenuation over distance so far horizon water is silky and never noisy
    float distAtten = 1.0 / (1.0 + dist * 0.00028);
    xDelta *= distAtten;
    yDelta *= distAtten;

    vec3 normal = normalize(vec3(
      -xDelta,
      max(1.0 - pow(abs(xDelta + yDelta), 2.0), 0.22),
      -yDelta
    ));

    // 2. Depth Calculation & Seabed Caustics near the beach
    // Gentle continental shelf slope so the turquoise-green shallow shore area extends much wider (~450m)
    float shelfNoise = (smoothNoise2D(local * 0.0025) - 0.5) * 0.18;
    float waterDepthMeters = clamp(coastDist * (0.0042 + shelfNoise * 0.001), 0.08, 45.0);
    float depthDiff = waterDepthMeters / max(viewDir.y, 0.28);

    vec3 seabedColor = vec3(0.28, 0.25, 0.18) * dayVis;
    #if WATER_HQ > 0
    if (depthDiff > 0.05 && depthDiff < 50.0) {
      vec3 groundWorldPos = vec3(worldXZ.x, 0.0, worldXZ.y) - viewDir * depthDiff;
      float causticsValue = waterCaustics(groundWorldPos, sunVec, depthDiff, time);
      float causticMultiplier = pow(max(causticsValue * _CausticsBrightness, 0.0), _CausticsPower);
      seabedColor *= clamp(causticMultiplier, 0.65, 2.2);
    }
    #endif

    // 3. Water Color Absorption (Volumetric Scattering)
    vec3 waterAbsorb = vec3(0.392, 0.108, 0.066) * (15.0 / max(_DepthDistance, 0.1));
    vec3 transmittanceWater = exp(-waterAbsorb * depthDiff);

    vec3 dirtScatter = _WaterColor * 0.25;
    vec3 waterInscatter = dirtScatter * (1.0 - transmittanceWater) * max(sunVec.y, 0.2) * 1.35 * dayVis;

    vec3 finalBaseColor = seabedColor * transmittanceWater + waterInscatter;

    // Soft shoreline surf & subtle wave crest foam
    float foam = smoothstep(0.48, 0.68, wh0) * 0.22 + (1.0 - smoothstep(0.0, 22.0, coastDist)) * 0.45;
    finalBaseColor = mix(finalBaseColor, vec3(0.92, 0.96, 1.0) * dayVis, clamp(foam, 0.0, 0.55));

    // 4. Fresnel
    // Reduce Fresnel slightly in the shallow shore zone so the green/turquoise shelf stays vibrant at grazing angles
    float shallowMask = 1.0 - smoothstep(0.0, 420.0, coastDist);
    float VdotN = clamp(pow(max(dot(viewDir, normal), 0.0), _FresnelPower), 0.0, 1.0);
    float roughness = 1.0 - _Smoothness;
    float fresnelAmount = shlickFresnelRoughness(VdotN, roughness);

    float f0_water = _ReflectionStrength;
    float finalFresnel = clamp(f0_water + (1.0 - f0_water) * fresnelAmount, 0.0, 1.0);
    finalFresnel *= mix(1.0, 0.52, shallowMask);

    vec3 reflectDir = reflect(-viewDir, normal);
    reflectDir.y = max(reflectDir.y, 0.01);

    // 4.1 Sky Reflection + Volumetric Cloud Reflection
    #if WATER_HQ > 0
    vec3 skyReflection = sampleWaterSkyReflection(reflectDir, sunVec, transitFactor);
    if (reflectDir.y > 0.02) {
      vec3 reflWorld = normalize(east * reflectDir.x + n * reflectDir.y + north * reflectDir.z);
      vec3 nfRefl = toEcef(reflWorld);
      float cCover = weatherCover(nfRefl, dist);
      float cDens = cloudDensity((nfRefl * (R + 2400.0)) / 1000.0, 2400.0, cCover);
      if (cDens > 0.005) {
        vec3 actualLightColor = getWaterSunColor(sunVec) * dayVis;
        float cloudAlpha = clamp(cDens * 0.65, 0.0, 0.85);
        vec3 cloudReflCol = actualLightColor * (0.55 + 0.45 * exp(-cDens * 1.8));
        skyReflection = mix(skyReflection, cloudReflCol, cloudAlpha);
      }
    }
    #else
    // Fast 2-tap atmospheric sky reflection on Low so colors match High 1:1
    vec3 rDir = normalize(vec3(reflectDir.x, max(reflectDir.y, 0.02), reflectDir.z));
    float muR = max(rDir.y, 0.02);
    float lenR = raySphereH(0.0, muR, HA).y;
    vec3 sumR = vec3(0.0);
    vec3 sumM = vec3(0.0);
    vec3 transR = vec3(1.0);
    float dsR = lenR * 0.5;
    for (int i = 0; i < 2; i++) {
      float tR = (float(i) + 0.35) * dsR;
      float hR = max(heightAt(0.0, muR, tR), 0.0);
      vec3 densR = skyDensity(hR) * dsR;
      vec3 stepODR = BETA_R * densR.x + BETA_M * 1.1 * densR.y + BETA_O * densR.z;
      vec3 stepTR = exp(-stepODR);
      vec3 stepVisR = transR * clamp((1.0 - stepTR) / max(stepODR, vec3(1e-6)), 0.0, 1.0);
      vec3 sunTransR = extinction(sunDepth(hR, max(sunVec.y, 0.02)));
      sumR += stepVisR * sunTransR * densR.x;
      sumM += stepVisR * sunTransR * densR.y;
      transR *= stepTR;
    }
    float nuR = dot(rDir, sunVec);
    float phaseRR = 3.0 / (16.0 * PI) * (1.0 + nuR * nuR);
    float g2R = G * G;
    float phaseMR = 3.0 / (8.0 * PI) * ((1.0 - g2R) * (1.0 + nuR * nuR)) / ((2.0 + g2R) * pow(1.0 + g2R - 2.0 * G * nuR, 1.5));
    vec3 skyReflection = (sumR * BETA_R * phaseRR + sumM * BETA_M * phaseMR) * uSunIntensity * transitFactor;
    #endif

    // 4.3 Specular Highlights (GGX Direct Sun Reflection)
    vec3 actualLightColor = getWaterSunColor(sunVec) * dayVis;
    vec3 ggxSpecular = waterGGX(normal, viewDir, sunVec, roughness, vec3(f0_water));
    skyReflection += ggxSpecular * actualLightColor * 3.5 * shadow;

    // 5. Final Composite
    vec3 finalComposite = mix(finalBaseColor, skyReflection, finalFresnel);
    return mix(vec3(0.005, 0.024, 0.055) * dayVis, finalComposite, nearW);
  }

  // Orbital / high-altitude water shading
  float cosV = max(viewDir.y, 0.0);
  float F = 0.04 + 0.96 * pow(1.0 - cosV, 5.0);
  vec3 r = reflect(d, n);
  float spec = pow(max(dot(r, L), 0.0), 120.0) * 0.45 * shadow;
  vec3 body = vec3(0.005, 0.024, 0.055) * uSunIntensity * sunT * (max(sunVec.y, 0.0) * 0.25 + 0.05);
  vec3 skyR = uSunIntensity * vec3(0.02, 0.05, 0.12) * dayVis;
  return body * (1.0 - F) + skyR * F + uSunIntensity * sunT * spec;
}

vec3 moonAlbedo(vec3 n) {
  float maria = smoothstep(0.48, 0.58, fbm(n * 1.6 + 3.0, 5));
  float base = mix(0.36, 0.17, maria);
  float c = 0.0;
  for (int k = 0; k < 3; k++) {
    float sc = k == 0 ? 6.0 : (k == 1 ? 14.0 : 32.0);
    float d = cellDist(n * sc + float(k) * 11.0);
    c += (smoothstep(0.26, 0.33, d) * smoothstep(0.42, 0.33, d) * 0.45 - smoothstep(0.32, 0.18, d) * 0.35) * (0.6 / (1.0 + float(k)));
  }
  float a = base + c * 0.4 + (fbm(n * 40.0, 3) - 0.5) * 0.08;
  return vec3(a) * vec3(1.0, 0.97, 0.93);
}

vec3 stars(vec3 d) {
  vec3 col = vec3(0.0);
  for (int k = 0; k < 2; k++) {
    float scale = k == 0 ? 110.0 : 240.0;
    vec3 p = d * scale + float(k) * 19.0;
    vec3 cell = floor(p);
    vec3 f = fract(p);
    float h = hash13(cell);
    if (h < 0.93) continue;
    vec3 c = 0.25 + 0.5 * hash33(cell);
    float dist = length(f - c);
    float size = max(0.04, length(fwidth(p)) * 0.8);
    float b = exp(-dist * dist / (size * size)) * (pow(hash13(cell + 7.0), 5.0) * 2.5 + 0.2);
    col += mix(vec3(1.0, 0.8, 0.6), vec3(0.8, 0.88, 1.0), hash13(cell + 3.0)) * b * (k == 0 ? 1.0 : 0.5);
  }
  vec3 galN = normalize(vec3(0.3, 0.35, 0.9));
  float band = exp(-pow(dot(d, galN) / 0.16, 2.0));
  col += vec3(0.55, 0.6, 0.8) * band * fbm(d * 6.0, 4) * 1.5 * 0.02;
  return col;
}

void main() {
  vec3 d = normalize(uWorldToEci * normalize(vDir));
  vec3 up = normalize(uCamUp);
  vec3 L = normalize(uSunDir);
  float h0 = max(uCamAlt, 0.5);
  float mu = dot(d, up);
  float nu = dot(d, L);

  // Dynamic Moon-Sun transit dimming (using chord length for full 32-bit float precision)
  float moonDist = max(length(uMoonRel), 1.0);
  vec3 moonDir = uMoonRel / moonDist;
  float moonAng = RM / moonDist;
  float sunAng = 0.00705;
  float sunMoonSep = length(L - moonDir);
  float transitProgress = smoothstep(abs(moonAng - sunAng) * 0.75, moonAng + sunAng, sunMoonSep);
  float transitFactor = mix(0.025, 1.0, pow(transitProgress, 1.35));

  vec2 atmo = raySphereH(h0, mu, HA);
  vec2 ground = raySphereH(h0, mu, 0.0);
  bool hitGround = ground.x < ground.y && ground.x > 0.0;

  // Numerically stable Moon ray-sphere intersection (avoids float32 cancellation at lunar distance)
  float bM = dot(d, uMoonRel);
  vec3 perpM = uMoonRel - d * bM;
  float discM = RM * RM - dot(perpM, perpM);
  float tMoon = -1.0;
  if (bM > 0.0 && discM > 0.0) {
    float t = bM - sqrt(discM);
    if (t > 0.0) tMoon = t;
  }
  bool hitMoon = tMoon > 0.0 && (!hitGround || tMoon < ground.x);
  if (hitMoon) hitGround = false;

  // Atmospheric scattering with Ozone absorption, analytic step transmittance,
  // dithered sampling, and multi-scattering ambient approximation.
  vec3 inscatter = vec3(0.0);
  vec3 viewT = vec3(1.0);
  float tEnd = hitGround ? ground.x : atmo.y;
  float tStart = max(atmo.x, 0.0);
  if (atmo.x < atmo.y && atmo.y > 0.0 && tEnd > tStart) {
    float span = tEnd - tStart;
    float atmoJitter = hash13(vec3(gl_FragCoord.xy, 1.7)) * 0.34;
    vec3 sumR = vec3(0.0);
    vec3 sumM = vec3(0.0);
    vec3 sumAmb = vec3(0.0);
    for (int i = 0; i < VIEW_STEPS; i++) {
      float u = (float(i) + 0.33 + atmoJitter) / float(VIEW_STEPS);
      float uMid = (float(i) + 0.5) / float(VIEW_STEPS);
      float t = tStart + span * u * u;
      float ds = span * 2.0 * uMid / float(VIEW_STEPS);
      float h = max(heightAt(h0, mu, t), 0.0);
      vec3 dens = skyDensity(h);
      vec3 stepAirmass = dens * ds;
      vec3 stepOD = BETA_R * stepAirmass.x + BETA_M * 1.1 * stepAirmass.y + BETA_O * stepAirmass.z;
      vec3 stepT = exp(-stepOD);
      vec3 stepFrac = clamp((1.0 - stepT) / max(stepOD, vec3(1e-6)), 0.0, 1.0);
      vec3 stepVis = viewT * stepFrac;

      vec3 upS = normalize(up * (R + h0) + d * t);
      float sunElev = dot(upS, L);
      vec3 odSun = sunDepth(h, sunElev);
      if (odSun.x < 1e8) {
        vec3 sunTrans = extinction(odSun);
        sumR += stepVis * sunTrans * stepAirmass.x;
        sumM += stepVis * sunTrans * stepAirmass.y;
      }
      float lowSun = clamp((1.0 - abs(sunElev)) * 1.5, 1.0, 1.8);
      float dayAmb = smoothstep(-0.24, 0.25, sunElev);
      sumAmb += stepVis * (BETA_R * stepAirmass.x + BETA_M * 0.25 * stepAirmass.y) * lowSun * dayAmb;

      viewT *= stepT;
    }
    float phaseR = 3.0 / (16.0 * PI) * (1.0 + nu * nu);
    float g2 = G * G;
    float phaseM = 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + nu * nu)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * G * nu, 1.5));
    vec3 directScatter = sumR * BETA_R * phaseR + sumM * BETA_M * phaseM;
    inscatter = uSunIntensity * transitFactor * (directScatter + sumAmb * 0.042);
  }

  vec3 col;
  float tSurface = hitGround ? ground.x : (hitMoon ? tMoon : 1e12);
  if (hitGround) {
    float t = ground.x;
    vec3 n = normalize(up * (R + h0) + d * t);
    vec3 nf = toEcef(n);
    vec3 fromPad = uCamFromPad + d * t;
    vec2 local = vec2(dot(fromPad, uPadEast), dot(fromPad, uPadNorth));
    float padDist = length(fromPad);
    float waterFar;
    float heightFar;
    vec3 albedo = globalAlbedo(nf, waterFar, heightFar);
    float wNear = 1.0 - smoothstep(35000.0, 140000.0, padDist);
    float water = waterFar;
    float coastDist = 1e5;
    if (wNear > 0.0) {
      float waterNear;
      vec3 albedoNear = nearAlbedo(local, t, waterNear, coastDist);
      albedo = mix(albedo, albedoNear, wNear);
      water = mix(waterFar, waterNear, wNear);
    }
    float ndl = dot(n, L);
    vec3 sunT = extinction(sunDepth(0.0, ndl)) * transitFactor;

    // Cloud shadows: density above this point along the line to the Sun.
    float shadow = 1.0;
    if (ndl > 0.0) {
      float cover = weatherCover(nf, padDist);
      if (cover > 0.04) {
        float hMid = 2300.0;
        vec3 pk = (nf * R + toEcef(L) * (hMid / max(ndl, 0.15))) / 1000.0;
        shadow = exp(-cloudDensity(pk, hMid, cover) * 4.0);
      }
    }

    vec3 sunLight = uSunIntensity * sunT * max(ndl, 0.0) / PI * shadow;
    vec3 skyLight = uSunIntensity * transitFactor * vec3(0.012, 0.022, 0.045) * smoothstep(-0.1, 0.3, ndl);
    vec3 landCol = albedo * (sunLight + skyLight) * viewT + inscatter;
    float night = 1.0 - smoothstep(-0.15, 0.05, ndl);
    float cities = (1.0 - water) * smoothstep(0.5, 0.62, fbm(nf * 5.0 + 11.0, 3)) * smoothstep(0.62, 0.85, fbm(nf * 60.0, 3));
    landCol += vec3(1.0, 0.6, 0.25) * cities * night * 0.02 * uSunIntensity * viewT;

    vec3 seaCol = shadeWater(n, d, L, sunT, shadow, t, local, coastDist, wNear, h0, transitFactor);
    // Keep near-pad water crisp (it already computes its own sky/horizon reflection),
    // blending into atmospheric aerial perspective only at high altitude / orbital distances.
    float orbitalFade = smoothstep(5000.0, 60000.0, h0);
    seaCol = mix(seaCol, seaCol * viewT + inscatter, orbitalFade);
    col = mix(landCol, seaCol, clamp(water, 0.0, 1.0));
  } else if (hitMoon) {
    vec3 p = d * tMoon - uMoonRel;
    vec3 n = normalize(p);
    vec3 albedo = moonAlbedo(n);
    float ndl = max(dot(n, L), 0.0);
    float ndv = max(dot(n, -d), 0.0);
    float ls = ndl / (ndl + ndv + 1e-4) * 2.0;
    // Faint earthshine on the lunar night side during a solar transit
    vec3 earthshine = albedo * vec3(0.0014, 0.0019, 0.0028) * uSunIntensity * viewT * (1.0 - transitProgress);
    col = albedo * uSunIntensity * mix(ndl, ls, 0.6) / PI * viewT + earthshine + inscatter;
  } else {
    col = inscatter;
    float sunRayAng = length(d - L);
    float sunDisc = 1.0 - smoothstep(sunAng * 0.93, sunAng * 1.04, sunRayAng);
    col += sunDisc * uSunIntensity * 40.0 * viewT;
    col += uSunIntensity * transitFactor * viewT * vec3(1.0, 0.85, 0.65) * pow(max(nu, 0.0), 900.0) * 0.6;

    // Solar corona and chromospheric rim around the lunar silhouette during totality / deep transit
    float overlap = 1.0 - transitProgress;
    if (overlap > 0.01) {
      float moonRayAng = length(d - moonDir);
      float rRatio = max(moonRayAng / max(moonAng, 1e-4), 1.0);
      vec3 moonRight = normalize(cross(up, moonDir) + vec3(1e-5));
      vec3 moonUp = cross(moonDir, moonRight);
      float posAngle = atan(dot(d - moonDir, moonUp), dot(d - moonDir, moonRight));
      float streamers = 0.78 + 0.22 * sin(posAngle * 4.0 + 0.7) * cos(posAngle * 3.0 - 0.4) + 0.12 * sin(posAngle * 9.0);
      float innerCorona = exp(-(rRatio - 1.0) * 5.2);
      float outerCorona = exp(-(rRatio - 1.0) * 1.55) * streamers;
      float chromosphere = exp(-(rRatio - 1.0) * 26.0);
      float totality = 1.0 - smoothstep(0.0, (moonAng - sunAng) * 2.4 + 0.0009, sunMoonSep);
      vec3 coronaCol =
        vec3(1.0, 0.98, 0.94) * (innerCorona * 2.4 + outerCorona * 0.85) +
        vec3(1.0, 0.36, 0.46) * chromosphere * 1.6;
      col += coronaCol * uSunIntensity * viewT * (totality * 0.95 + pow(overlap, 3.0) * 0.18);
    }

    float skyLum = dot(inscatter, vec3(0.2126, 0.7152, 0.0722));
    col += stars(d) * exp(-skyLum * 40.0) * 1.5;
  }

  // Volumetric cumulus + high-altitude curl-noise cirrus in depth order.
  #if CLOUD_STEPS > 0
  vec4 cirrus = sampleCirrus(up, h0, mu, d, L, tSurface, transitFactor);
  vec2 seg = cloudSegment(h0, mu, tSurface);
  vec4 cumulus = vec4(0.0, 0.0, 0.0, 1.0);
  if (seg.x >= 0.0) {
    cumulus = marchClouds(up, h0, mu, d, L, seg, transitFactor);
    float alpha = 1.0 - cumulus.a;
    if (alpha > 0.001) {
      float tC = seg.x + (seg.y - seg.x) * 0.3;
      float haze = (1.0 - exp(-tC / 45000.0)) * (1.0 - smoothstep(CT, 20000.0, h0));
      cumulus.rgb = mix(cumulus.rgb, inscatter * alpha, haze * 0.85);
    }
  }
  if (h0 < CIRRUS_H) {
    col = col * cirrus.a + cirrus.rgb;
    col = col * cumulus.a + cumulus.rgb;
  } else {
    col = col * cumulus.a + cumulus.rgb;
    col = col * cirrus.a + cirrus.rgb;
  }
  #endif

  gl_FragColor = vec4(col, 1.0);
  ${fragmentDepth}
}
`;
