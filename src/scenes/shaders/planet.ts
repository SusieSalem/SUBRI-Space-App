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
  // This sphere follows the camera, which can be 1e8..2e9 m from the origin. Multiplying by
  // modelMatrix and then viewMatrix would add and cancel two numbers that big in float32
  // (steps of 8..256 m on a sphere of radius 1000), so the sky jumped around when the camera
  // moved far out. modelViewMatrix is built in double precision on the CPU, where they cancel.
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  ${vertexTail}
}
`;

const planetHeaderAndClouds = /* glsl */ `
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
uniform float uWeather;   // 0 = clear, 1 = cloudy, 2 = rain, 3 = storm
uniform sampler2D uEarthDay;   // NASA Blue Marble 2K equirectangular daylight texture
uniform sampler2D uEarthNight; // NASA Black Marble 2K equirectangular nighttime city lights
uniform sampler2D uEarthSpec;  // NASA Earth 2K land/water specular mask
uniform sampler2D uMoonColor;  // NASA SVS CGI Moon Kit, LRO LROC WAC 2K colour map (equirectangular, lon 0 at centre)
uniform vec3 uMoonNorth;       // ECI, lunar north pole (normal of the Moon's orbit)
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
// The LRO map is stored bright (highlands near white); this brings it to the old range,
// about 0.30 for the highlands and 0.12 for the maria.
const float MOON_ALBEDO_GAIN = 0.45;
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

// Convert ECEF unit vector n to geographic (lonDeg, latDeg) and equirectangular UV
// anchored so the launch pad at n = (0, 1, 0) sits on the Cape Canaveral / Florida
// Atlantic coast (-80.6° W, +28.5° N).
vec2 ecefToLonLatDeg(vec3 n) {
  const float cLat0 = 0.878817; // cos(28.5 deg)
  const float sLat0 = 0.477159; // sin(28.5 deg)
  // Geographic north at the pad is -Z in the physics frame (the Earth spins about -Z).
  vec3 nGeo = vec3(n.x, n.y * cLat0 + n.z * sLat0, n.y * sLat0 - n.z * cLat0);
  float latDeg = degrees(asin(clamp(nGeo.z, -1.0, 1.0)));
  float lonDeg = degrees(atan(nGeo.x, nGeo.y)) - 80.6;
  if (lonDeg < -180.0) lonDeg += 360.0;
  if (lonDeg > 180.0) lonDeg -= 360.0;
  return vec2(lonDeg, latDeg);
}

// Mipmapped lookup without a seam at the date line: the u gradient is unwrapped by hand.
vec3 sampleEarth(sampler2D tex, vec2 uv) {
  vec2 dx = dFdx(uv);
  vec2 dy = dFdy(uv);
  if (abs(dx.x) > 0.5) dx.x -= sign(dx.x);
  if (abs(dy.x) > 0.5) dy.x -= sign(dy.x);
  return textureGrad(tex, uv, dx, dy).rgb;
}

vec2 ecefToEarthUV(vec3 n) {
  vec2 ll = ecefToLonLatDeg(n);
  return vec2(fract((ll.x + 180.0) / 360.0), clamp((ll.y + 90.0) / 180.0, 0.001, 0.999));
}

// Global Earth albedo & land/water mask from NASA Blue Marble (uEarthDay) and
// NASA Earth specular land/water mask (uEarthSpec).
vec3 globalAlbedo(vec3 n, out float water, out float height) {
  vec2 uv = ecefToEarthUV(n);
  vec3 dayTex = pow(sampleEarth(uEarthDay, uv), vec3(2.2));
  // In uEarthSpec, 1.0 = ocean/water and 0.0 = land/continents
  float specWater = sampleEarth(uEarthSpec, uv).r;
  float land = 1.0 - smoothstep(0.18, 0.55, specWater);
  water = 1.0 - land;
  height = mix(0.45, 0.65, land);

  // Add subtle high-frequency terrain micro-detail for low-orbit ascent views
  float detail = fbm(n * 24.0, 3);
  vec3 landCol = dayTex * (0.95 + 0.1 * detail);
  vec3 oceanCol = dayTex;
  return mix(oceanCol, landCol, land);
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
  float padTarget = uWeather < 0.5 ? 0.06 : (uWeather < 1.5 ? 0.34 : (uWeather < 2.5 ? 0.64 : 0.74));
  return mix(cover, padTarget, 1.0 - smoothstep(20000.0, 140000.0, padDist));
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
  float densMult = uWeather > 2.5 ? 4.6 : (uWeather > 1.5 ? 4.0 : 3.5);
  return clamp(d * densMult, 0.0, 1.0);
}

// ---------------- 1D Perlin FBM & Volumetric Lightning (Storm Mode) ----------------
const vec3 BOLT_COLOUR = vec3(0.3, 0.6, 1.0);

float hash11(float p) {
  vec3 p3 = fract(vec3(p) * 0.1031);
  p3 += dot(p3, p3.yzx + 19.19);
  return fract((p3.x + p3.y) * p3.z);
}

float fade1D(float t) {
  return t * t * t * (t * (6.0 * t - 15.0) + 10.0);
}

float grad1D(float h, float p) {
  return mod(floor(1e4 * h), 2.0) < 1.0 ? p : -p;
}

float perlinNoise1D(float p) {
  float pi = floor(p);
  float pf = p - pi;
  float w = fade1D(pf);
  return mix(grad1D(hash11(pi), pf), grad1D(hash11(pi + 1.0), pf - 1.0), w) * 2.0;
}

float fbm1D(float pos) {
  if (pos < 0.0) return 0.0;
  float total = 0.0;
  float frequency = 0.2;
  float amplitude = 1.0;
  for (int i = 0; i < 4; i++) {
    if (i > 2) pos += 0.5 * uRealTime;
    total += perlinNoise1D(pos * frequency) * amplitude;
    amplitude *= 0.5;
    frequency *= 2.0;
  }
  return total;
}

float getGlow(float dist, float radius, float intensity) {
  dist = max(dist, 1e-5);
  return pow(radius / dist, intensity);
}

// Compute active state and horizontal pad offset (East, North in metres) for lightning bolt slot idx (0..2)
bool getBoltInfo(
  int idx,
  out vec2 boltXZ,
  out float progress,
  out float boltRadius,
  out float boltIntensity,
  out float tSeries
) {
  float fi = float(idx);
  float speed = 1.35;
  float shift = fract((fi + 1.0) * 0.3333);
  float time = uRealTime * speed + shift;
  tSeries = floor(time) + 1.0;

  // Strike probability across the 3 staggered bolt slots
  if (hash11(fi + tSeries * 0.026) > 0.44) {
    boltXZ = vec2(1e10);
    progress = 0.0;
    boltRadius = 0.01;
    boltIntensity = 0.0;
    return false;
  }

  // Pick a strike location around the launch site (1.5 km to 4.8 km away) inside a dense cloud cell
  vec2 bestLoc = vec2(2000.0, 1200.0);
  float bestShape = -1.0;
  for (int c = 0; c < 3; c++) {
    float seed = tSeries * 1.17 + fi * 7.3 + float(c) * 19.1;
    float ang = hash11(seed + 0.43) * 6.283185;
    float rad = mix(1500.0, 4800.0, hash11(seed + 0.31));
    vec2 candXZ = vec2(cos(ang), sin(ang)) * rad;
    vec3 nCand = normalize(vec3(0.0, R + 2100.0, 0.0) + uPadEast * candXZ.x + uPadNorth * candXZ.y);
    vec3 pkCand = toEcef(nCand) * ((R + 2100.0) / 1000.0);
    vec3 qCand = pkCand + vec3(uTime * 0.008, 0.0, uTime * 0.003);
    float sh = fbm(qCand * 0.38, 3);
    if (sh > bestShape) {
      bestShape = sh;
      bestLoc = candXZ;
    }
  }
  boltXZ = bestLoc;

  float descentDuration = 0.48;
  float ft = fract(time);
  progress = clamp(ft / descentDuration, 0.0, 1.0);

  // Briefly thicken & brighten the bolt the moment it makes contact with the ground/sea
  if (progress > 0.95 && ft - descentDuration < 0.12) {
    boltRadius = 0.026;
    boltIntensity = 2.4;
  } else {
    boltRadius = 0.011;
    boltIntensity = 1.0 - smoothstep(descentDuration + 0.10, 0.92, ft);
  }
  return boltIntensity > 0.01;
}

// Analytical cloud-to-ground lightning bolt glow below the cloud base (CB)
vec3 sampleLightningBolts(vec3 d, float h0, float mu, float tMax, out float minBoltT) {
  minBoltT = 1e10;
  if (uWeather < 2.5 || h0 > 35000.0) return vec3(0.0);

  vec2 roXZ = vec2(dot(uCamFromPad, uPadEast), dot(uCamFromPad, uPadNorth));
  vec2 rdXZ = vec2(dot(d, uPadEast), dot(d, uPadNorth));
  float rd2 = max(dot(rdXZ, rdXZ), 1e-5);
  vec3 glow = vec3(0.0);

  for (int i = 0; i < 3; i++) {
    vec2 boltXZ;
    float progress;
    float boltRadius;
    float boltIntensity;
    float tSeries;
    if (!getBoltInfo(i, boltXZ, progress, boltRadius, boltIntensity, tSeries)) continue;

    float tHit = clamp(dot(boltXZ - roXZ, rdXZ) / rd2, 0.0, tMax);
    float yHit = heightAt(h0, mu, tHit);
    float yTop = CB + 140.0;
    float yBot = yTop * (1.0 - progress);
    float yClamped = clamp(yHit, yBot, yTop);

    // 1D Perlin FBM jagging along the descending bolt
    float shapeOffset = 15.2 * exp2(float(i));
    float yInput = max(0.0, (yTop - yClamped) * 0.014);
    vec2 jag = vec2(
      fbm1D(shapeOffset + tSeries * 0.2 + yInput),
      fbm1D(shapeOffset + tSeries * 0.12 - yInput)
    ) * 85.0;

    vec2 warpedXZ = boltXZ + jag;
    float tRef = clamp(dot(warpedXZ - roXZ, rdXZ) / rd2, 0.0, tMax);
    float yRay = heightAt(h0, mu, tRef);
    vec2 rayXZ = roXZ + rdXZ * tRef;

    float dxz = length(rayXZ - warpedXZ);
    float dy = max(max(yBot - yRay, yRay - yTop), 0.0);
    float distKm = length(vec2(dxz, dy)) / 1000.0;
    if (distKm >= 0.42) continue;

    // Smooth finite-range falloff so lightning glow never flashes the entire sky or clips at tMax
    float rangeFade = 1.0 - smoothstep(0.14, 0.42, distKm);
    minBoltT = min(minBoltT, tRef);
    float g = getGlow(distKm, boltRadius, 0.90) * rangeFade;
    float core = exp(-distKm / max(boltRadius * 0.45, 1e-4)) * 2.5 * rangeFade;
    glow += (BOLT_COLOUR * g + vec3(0.85, 0.94, 1.0) * core) * boltIntensity * uSunIntensity * 0.85;
  }
  return glow;
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

// Ray-marched cumulus with dual-octave multi-scattering, Beer-Powder & internal storm lightning.
vec4 marchClouds(vec3 up, float h0, float mu, vec3 d, vec3 L, vec2 seg, float transitFactor, out float closestCloudT) {
  closestCloudT = 1e10;
  float span = seg.y - seg.x;
  float tMid = seg.x + span * 0.3;
  vec3 nMid = normalize(up * (R + h0) + d * tMid);
  float cover = weatherCover(toEcef(nMid), length(uCamFromPad + d * tMid));
  if (cover < 0.04) return vec4(0.0, 0.0, 0.0, 1.0);

  float muS = dot(nMid, L);
  float stormDim = uWeather > 2.5 ? 0.42 : (uWeather > 1.5 ? 0.65 : 1.0);
  vec3 sunCol = uSunIntensity * transitFactor * stormDim * extinction(sunDepth(2500.0, muS)) * step(-0.08, muS);
  vec3 ambient = uSunIntensity * transitFactor * stormDim * vec3(0.04, 0.065, 0.105) * (0.015 + 0.985 * smoothstep(-0.14, 0.3, muS));
  float cosT = dot(d, L);
  float phase = mix(hg(0.72, cosT), hg(-0.28, cosT), 0.32) * 2.8;
  float phaseMulti = mix(hg(0.35, cosT), 1.0 / (4.0 * PI), 0.5) * 1.6;
  vec3 Lf = toEcef(L);
  float jitter = hash13(vec3(gl_FragCoord.xy, 3.7));

  // Precompute storm internal sheet-lightning & bolt exit positions once per pixel
  vec2 b0 = vec2(1e10), b1 = vec2(1e10), b2 = vec2(1e10);
  float act0 = 0.0, act1 = 0.0, act2 = 0.0;
  vec2 intXZ = vec2(1e10);
  float intH = 2600.0;
  float intSize = 0.0;
  float intActive = 0.0;
  if (uWeather > 2.5 && h0 < 35000.0) {
    float pDummy, rDummy, tsDummy;
    getBoltInfo(0, b0, pDummy, rDummy, act0, tsDummy);
    getBoltInfo(1, b1, pDummy, rDummy, act1, tsDummy);
    getBoltInfo(2, b2, pDummy, rDummy, act2, tsDummy);

    // Internal sheet lightning flickering inside the cloud core
    float intTick = floor(uRealTime * 3.8);
    if (hash11(intTick * 0.73 + 1.19) < 0.65) {
      float ang = hash11(intTick + 0.17) * 6.283185;
      float rad = mix(1200.0, 4400.0, hash11(intTick + 0.53));
      intXZ = vec2(cos(ang), sin(ang)) * rad;
      intH = CB + (CT - CB) * (0.35 + 0.35 * hash11(intTick + 0.81));
      intSize = (0.42 + 0.16 * sin(45.0 * fract(uRealTime)));
      intActive = sin(fract(uRealTime * 3.8) * 3.14159);
    }
  }

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
    closestCloudT = min(closestCloudT, t);
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

    // Internal cloud lightning flash + exit glow at bottom of cloud where bolts emerge
    vec3 internalLight = vec3(0.0);
    if (uWeather > 2.5 && h0 < 35000.0) {
      vec3 fromPadS = uCamFromPad + d * t;
      vec2 sampleXZ = vec2(dot(fromPadS, uPadEast), dot(fromPadS, uPadNorth));
      if (intActive > 0.01) {
        float prox = length(vec3((sampleXZ - intXZ) / 1000.0, (h - intH) / 700.0));
        internalLight += getGlow(prox, intSize, 2.6) * BOLT_COLOUR * intActive;
      }
      float hExit = CB * 1.05;
      if (act0 > 0.01) {
        float p0 = length(vec3((sampleXZ - b0) / 1000.0, (h - hExit) / 650.0));
        internalLight += getGlow(p0, 0.38, 2.2) * BOLT_COLOUR * act0 * 1.3;
      }
      if (act1 > 0.01) {
        float p1 = length(vec3((sampleXZ - b1) / 1000.0, (h - hExit) / 650.0));
        internalLight += getGlow(p1, 0.38, 2.2) * BOLT_COLOUR * act1 * 1.3;
      }
      if (act2 > 0.01) {
        float p2 = length(vec3((sampleXZ - b2) / 1000.0, (h - hExit) / 650.0));
        internalLight += getGlow(p2, 0.38, 2.2) * BOLT_COLOUR * act2 * 1.3;
      }
      internalLight *= uSunIntensity * 1.4;
    }

    vec3 S = directLight + ambient * (0.50 + 0.50 * hf) + internalLight;
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

// Raindrop ripples & 3D falling rain streaks (intensifying inside rain/storm clouds).
float rainHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 19.19);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 rainHash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 19.19);
  return fract((p3.xx + p3.yz) * p3.zy);
}

vec3 rainRipples(vec2 fragCoord, float time, float intensity) {
  float cell_density = 5.0 * intensity;
  float size_compensation = cell_density / 5.0;
  vec2 uv = fragCoord * cell_density;
  vec2 p0 = floor(uv);
  const float wave_frequency = 21.0;
  vec2 circles = vec2(0.0);
  for (int j = -1; j <= 1; ++j) {
    for (int i = -1; i <= 1; ++i) {
      vec2 pi = p0 + vec2(float(i), float(j));
      vec2 p = pi + rainHash22(pi);
      float t = fract(0.9 * time + rainHash12(pi));
      vec2 v = p - uv;
      float vLen = max(length(v), 1e-4);
      float d = vLen - (2.0 * t) * size_compensation;
      const float h = 1e-2;
      float d1 = d - h;
      float d2 = d + h;
      float p1 = sin(wave_frequency * d1) * smoothstep(-0.6, -0.3, d1) * smoothstep(0.0, -0.3, d1);
      float p2 = sin(wave_frequency * d2) * smoothstep(-0.6, -0.3, d2) * smoothstep(0.0, -0.3, d2);
      circles += 0.5 * (v / vLen) * ((p2 - p1) / (2.0 * h) * (1.0 - t) * (1.0 - t));
    }
  }
  circles /= 9.0;
  return vec3(circles.x, sqrt(max(0.05, 1.0 - dot(circles, circles))), circles.y);
}

// Camera-lens raindrop distortion (returns normal offset in screen-aligned tangent space)
vec2 sampleLensDrops(vec2 uv, float time, float intensity) {
  vec2 totalOffset = vec2(0.0);
  for (int i = 0; i < 2; ++i) {
    float scale = i == 0 ? 7.5 : 13.0;
    float speed = i == 0 ? 0.55 : 0.85;
    vec2 aspect = vec2(scale * 1.4, scale * 0.72);
    vec2 st = uv * aspect;
    st.y += time * speed;
    vec2 id = floor(st);
    vec2 f = fract(st) - 0.5;
    vec2 rnd = rainHash22(id + float(i) * 37.1);
    float spawn = smoothstep(1.0 - clamp(0.22 * intensity, 0.05, 0.65), 1.0, rnd.x);
    if (spawn > 0.01) {
      vec2 dropPos = (rnd - 0.5) * 0.45;
      float wobble = sin(st.y * 2.2 + rnd.y * 6.283) * 0.06;
      vec2 delta = f - vec2(dropPos.x + wobble, dropPos.y);
      delta.y *= 1.45;
      float r = length(delta);
      float dropMask = smoothstep(0.24, 0.04, r) * spawn;
      // Subtle trailing streak above the sliding droplet
      float trail = smoothstep(0.08, 0.01, abs(delta.x)) * smoothstep(-0.02, 0.35, delta.y) * smoothstep(0.42, 0.12, delta.y) * 0.4 * spawn;
      totalOffset += (delta / max(r, 0.03)) * (dropMask + trail) * (i == 0 ? 1.0 : 0.6);
    }
  }
  return totalOffset;
}

vec4 sampleRaindrops(vec3 d, vec3 up, vec3 L, float h0, float transitFactor) {
  if (uWeather < 1.5 || h0 > CT + 380.0) return vec4(0.0);

  float camPadDist = length(uCamFromPad);
  if (camPadDist > 120000.0) return vec4(0.0);

  // Under clouds (0..CB): Rain is gentle, Storm is heavy. Inside clouds (CB..CT): both intensify.
  float inCloud = smoothstep(CB - 250.0, 2350.0, h0) * (1.0 - smoothstep(2850.0, CT + 350.0, h0));
  float aboveCloudFade = 1.0 - smoothstep(CT - 120.0, CT + 360.0, h0);
  float isStorm = step(2.5, uWeather);
  float baseDensity = mix(0.45, 1.25, isStorm);
  float rainStrength = aboveCloudFade * baseDensity * (1.0 + inCloud * mix(0.85, 1.35, isStorm));
  if (rainStrength <= 0.01) return vec4(0.0);

  vec3 east = uPadEast - up * dot(up, uPadEast);
  float eLen = length(east);
  east = eLen > 1e-3 ? east / eLen : normalize(cross(vec3(0.0, 0.0, 1.0), up));
  vec3 north = cross(up, east);

  float windTilt = mix(0.06, 0.22, isStorm);
  vec3 rainUp = normalize(up + east * windTilt);
  float elev = dot(d, rainUp);
  vec3 horiz = d - rainUp * elev;
  float horizLen = max(length(horiz), 0.12);
  vec3 hUnit = horiz / horizLen;
  float az = atan(dot(hUnit, north), dot(hUnit, east));
  float vProj = elev / max(horizLen, 0.24);
  float pitchFade = smoothstep(0.06, 0.36, horizLen);

  float accumAlpha = 0.0;
  for (int layer = 0; layer < 4; ++layer) {
    float layerWeight = layer == 3 ? inCloud * mix(0.75, 1.25, isStorm) : 1.0 / (1.0 + float(layer) * 0.45);
    if (layerWeight <= 0.01) continue;

    // Fine, hair-thin rain streaks instead of thick bars
    float cols = (220.0 + float(layer) * 140.0) * (1.0 + inCloud * 0.2);
    float uCoord = (az / (2.0 * PI) + 0.5) * cols + float(layer) * 11.7;
    float colId = floor(uCoord);
    float colHash = rainHash12(vec2(colId, float(layer) * 19.3 + 1.7));

    float dx = abs(fract(uCoord) - 0.5 - (colHash - 0.5) * 0.38);
    float fallSpeed = (16.0 + float(layer) * 5.0) * mix(0.95, 1.3, isStorm);
    float vScale = 2.8 + float(layer) * 1.4;
    float vCoord = vProj * vScale + uRealTime * fallSpeed + colHash * 29.4;
    float rowId = floor(vCoord);
    float rowHash = rainHash12(vec2(colId * 3.7 + float(layer) * 7.1, rowId));

    float spawnProb = clamp(0.22 * rainStrength, 0.0, 0.65);
    if (rowHash < spawnProb) {
      float dy = fract(vCoord);
      float width = layer == 3 ? 0.05 : 0.034;
      float streak =
        smoothstep(width, width * 0.12, dx) *
        smoothstep(0.02, 0.18, dy) *
        smoothstep(0.90, 0.18, dy);
      accumAlpha += streak * layerWeight * pitchFade;
    }
  }

  accumAlpha = clamp(accumAlpha * mix(0.17, 0.27, isStorm), 0.0, 0.45);
  // Rain curtain: far away the streaks merge into grey veils hanging under the clouds.
  float veil = fbm(vec3(az * 7.0, uRealTime * 0.15, 3.0), 3);
  float curtain = rainStrength * mix(0.16, 0.3, isStorm) * (1.0 - smoothstep(0.0, 0.32, abs(elev))) * smoothstep(0.35, 0.7, veil);
  accumAlpha = max(accumAlpha, curtain);
  // Only from the horizon up: the rain between the camera and the ground is drawn by the
  // screen-space RainLens effect. Drawing it here too painted long bright lines and pale
  // bands over the ground and the sea.
  accumAlpha *= smoothstep(-0.05, 0.03, dot(d, up));
  if (accumAlpha <= 0.002) return vec4(0.0);

  float muS = dot(up, L);
  float dayLight = 0.08 + 0.92 * smoothstep(-0.12, 0.25, muS) * transitFactor;
  float flashBoost = 0.0;
  if (uWeather > 2.5) {
    float intTick = floor(uRealTime * 3.8);
    if (hash11(intTick * 0.73 + 1.19) < 0.65) {
      flashBoost = sin(fract(uRealTime * 3.8) * 3.14159) * 0.38;
    }
  }
  vec3 rainAlbedo = vec3(0.68, 0.78, 0.90) * (dayLight * 0.42 + flashBoost + 0.06);
  return vec4(rainAlbedo, accumAlpha);
}
`;

export const planetFragment = /* glsl */ `
${planetHeaderAndClouds}

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
    // Real sun elevation: below the horizon sunDepth reports shadow and the sky goes dark.
    vec3 sunTrans = extinction(sunDepth(h, sunVec.y));
    sumR += stepVis * sunTrans * airmass.x;
    sumM += stepVis * sunTrans * airmass.y;
    trans *= stepT;
  }
  float nu = dot(rDir, sunVec);
  float phaseR = 3.0 / (16.0 * PI) * (1.0 + nu * nu);
  float g2 = G * G;
  float phaseM = 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + nu * nu)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * G * nu, 1.5));
  // Subtle midnight navy floor so a night sea stays dark without vanishing to pure black.
  vec3 nightFloor = uSunIntensity * vec3(0.00035, 0.0007, 0.0016) * (1.0 - smoothstep(-0.12, 0.2, sunVec.y));
  return (sumR * BETA_R * phaseR + sumM * BETA_M * phaseM) * uSunIntensity * transitFactor + nightFloor;
}

vec3 shadeWater(vec3 n, vec3 d, vec3 L, vec3 sunT, float shadow, float dist, vec2 local, float coastDist, float nearW, float h0, float transitFactor, vec3 photoSea) {
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

    // World position on the ocean surface (smooth large swells readable from pad or splashdown site)
    vec2 waveXZ = length(local) < 25000.0 ? local : mod(vec2(dot(d * dist, east), dot(d * dist, north)), 8192.0);
    vec2 worldXZ = waveXZ * 0.42;
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

    // Raindrop surface ripples on water during Rain or Storm
    if (uWeather > 1.5 && dist < 240.0) {
      float rInt = uWeather > 2.5 ? 1.35 : 0.9;
      float rFade = 1.0 - smoothstep(45.0, 240.0, dist);
      vec3 rNorm = rainRipples(waveXZ * 0.35, time, rInt);
      normal = normalize(normal + vec3(rNorm.x, 0.0, rNorm.z) * 1.45 * rFade);
    }

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
      vec3 sunTransR = extinction(sunDepth(hR, sunVec.y));
      sumR += stepVisR * sunTransR * densR.x;
      sumM += stepVisR * sunTransR * densR.y;
      transR *= stepTR;
    }
    float nuR = dot(rDir, sunVec);
    float phaseRR = 3.0 / (16.0 * PI) * (1.0 + nuR * nuR);
    float g2R = G * G;
    float phaseMR = 3.0 / (8.0 * PI) * ((1.0 - g2R) * (1.0 + nuR * nuR)) / ((2.0 + g2R) * pow(1.0 + g2R - 2.0 * G * nuR, 1.5));
    vec3 skyReflection = (sumR * BETA_R * phaseRR + sumM * BETA_M * phaseMR) * uSunIntensity * transitFactor
      + uSunIntensity * vec3(0.00035, 0.0007, 0.0016) * (1.0 - smoothstep(-0.12, 0.2, sunVec.y));
    #endif

    // 4.3 Specular Highlights (GGX Direct Sun Reflection)
    vec3 actualLightColor = getWaterSunColor(sunVec) * dayVis;
    vec3 ggxSpecular = waterGGX(normal, viewDir, sunVec, roughness, vec3(f0_water));
    skyReflection += ggxSpecular * actualLightColor * 3.5 * shadow;

    // 5. Final Composite
    vec3 finalComposite = mix(finalBaseColor, skyReflection, finalFresnel);
    vec3 photoBody = photoSea * uSunIntensity * sunT * (max(sunVec.y, 0.0) / PI + 0.03);
    return mix(photoBody, finalComposite, nearW);
  }

  // Orbital / high-altitude water shading
  float cosV = max(viewDir.y, 0.0);
  float F = 0.04 + 0.96 * pow(1.0 - cosV, 5.0);
  vec3 r = reflect(d, n);
  float spec = pow(max(dot(r, L), 0.0), 120.0) * 0.45 * shadow;
  // Ocean colour from the Blue Marble photo, lit like the land.
  vec3 body = photoSea * uSunIntensity * sunT * (max(sunVec.y, 0.0) / PI + 0.03);
  vec3 skyR = uSunIntensity * vec3(0.02, 0.05, 0.12) * dayVis;
  return body * (1.0 - F) + skyR * F + uSunIntensity * sunT * spec;
}

// Lunar albedo from the NASA LRO colour map. The Moon is tidally locked, so its
// longitude 0 (the centre of the map) always faces the Earth. toEarth is the
// direction from the Moon's centre to the Earth's centre.
vec3 moonAlbedo(vec3 n, vec3 toEarth) {
  vec3 ez = normalize(uMoonNorth);
  vec3 ex = normalize(toEarth - ez * dot(toEarth, ez));
  vec3 ey = cross(ez, ex); // east
  float lon = atan(dot(n, ey), dot(n, ex));
  float lat = asin(clamp(dot(n, ez), -1.0, 1.0));
  vec2 uv = vec2(fract(lon / (2.0 * PI) + 0.5), clamp(lat / PI + 0.5, 0.001, 0.999));
  vec3 tex = pow(sampleEarth(uMoonColor, uv), vec3(2.2));
  // A little fine grain so the 2K map (about 5 km per pixel) does not look flat up close.
  float grain = 1.0 + (fbm(n * 400.0, 3) - 0.5) * 0.12;
  return tex * MOON_ALBEDO_GAIN * grain;
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

  // Drops on the lens are drawn by the screen-space RainLens effect (scenes/RainLens.tsx).

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
    vec3 photo = albedo;
    // Close-up water (metre-scale waves) whenever the camera is low over the ocean (both at the pad
    // and at the splashdown recovery site); from orbit it fades smoothly to the Blue Marble ocean.
    float wNear = (1.0 - smoothstep(35000.0, 140000.0, t)) * (1.0 - smoothstep(3000.0, 30000.0, h0));
    float wSite = 1.0 - smoothstep(3000.0, 10000.0, padDist);
    float water = waterFar;
    float coastDist = 1e5;
    if (wSite > 0.0) {
      float waterNear;
      vec3 albedoNear = nearAlbedo(local, t, waterNear, coastDist);
      albedo = mix(albedo, albedoNear, wSite);
      water = mix(waterFar, waterNear, wSite);
    } else if (h0 < 1200.0) {
      // Ensure splashdown recovery away from the launch site always renders over open ocean waves
      water = max(waterFar, 1.0 - smoothstep(180.0, 1100.0, h0));
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
    // Moon and starlight: a dim blue floor so the ground is readable at night (the Sun term
    // above is zero there). It fades out as the Sun comes up.
    vec3 nightLight = vec3(0.07, 0.11, 0.21) * (1.0 - smoothstep(-0.12, 0.2, ndl));
    vec3 landCol = albedo * (sunLight + skyLight + nightLight) * viewT + inscatter;
    float night = 1.0 - smoothstep(-0.15, 0.05, ndl);
    vec3 nightTex = sampleEarth(uEarthNight, ecefToEarthUV(nf));
    float cityGlow = max(0.0, max(nightTex.r, nightTex.g) - nightTex.b * 0.65);
    cityGlow = pow(clamp(cityGlow * 1.75, 0.0, 1.0), 1.45) * (1.0 - water);
    // City lights (Black Marble) are a 2K map, about 20 km per pixel: seen from far away
    // they read as lit cities, but up close a single pixel would wash the whole ground
    // orange. So they only show at a distance, and never on the launch site itself.
    float cityFade = smoothstep(15000.0, 120000.0, t) * (1.0 - wSite);
    landCol += vec3(1.0, 0.68, 0.32) * cityGlow * night * 0.04 * uSunIntensity * viewT * cityFade;

    vec3 seaCol = shadeWater(n, d, L, sunT, shadow, t, local, coastDist, wNear, h0, transitFactor, photo);
    // Keep near-pad water crisp (it already computes its own sky/horizon reflection),
    // blending into atmospheric aerial perspective only at high altitude / orbital distances.
    float orbitalFade = smoothstep(5000.0, 60000.0, h0);
    seaCol = mix(seaCol, seaCol * viewT + inscatter, orbitalFade);
    col = mix(landCol, seaCol, clamp(water, 0.0, 1.0));
  } else if (hitMoon) {
    vec3 p = d * tMoon - uMoonRel;
    vec3 n = normalize(p);
    vec3 toEarth = -normalize(uCamUp) * (R + uCamAlt) - uMoonRel;
    vec3 albedo = moonAlbedo(n, normalize(toEarth));
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

  // Volumetric cumulus + high-altitude curl-noise cirrus + storm lightning bolts in depth order.
  #if CLOUD_STEPS > 0
  float minBoltT = 1e10;
  vec3 boltGlow = sampleLightningBolts(d, h0, mu, tSurface, minBoltT);
  vec4 cirrus = sampleCirrus(up, h0, mu, d, L, tSurface, transitFactor);
  vec2 seg = cloudSegment(h0, mu, tSurface);
  vec4 cumulus = vec4(0.0, 0.0, 0.0, 1.0);
  float closestCloudT = 1e10;
  if (seg.x >= 0.0) {
    cumulus = marchClouds(up, h0, mu, d, L, seg, transitFactor, closestCloudT);
    float alpha = 1.0 - cumulus.a;
    if (alpha > 0.001) {
      float tC = seg.x + (seg.y - seg.x) * 0.3;
      float haze = (1.0 - exp(-tC / 45000.0)) * (1.0 - smoothstep(CT, 20000.0, h0));
      cumulus.rgb = mix(cumulus.rgb, inscatter * alpha, haze * 0.85);
    }
  }
  // If lightning bolt is behind the cloud volume, attenuate it by cloud transmittance;
  // if in front of / below the cloud base, add it directly.
  if (minBoltT >= closestCloudT) {
    col += boltGlow * cumulus.a;
  }
  if (h0 < CIRRUS_H) {
    col = col * cirrus.a + cirrus.rgb;
    col = col * cumulus.a + cumulus.rgb;
  } else {
    col = col * cumulus.a + cumulus.rgb;
    col = col * cirrus.a + cirrus.rgb;
  }
  if (minBoltT < closestCloudT) {
    col += boltGlow;
  }
  #endif

  vec4 rain = sampleRaindrops(d, up, L, h0, transitFactor);
  col = mix(col, rain.rgb, rain.a);

  gl_FragColor = vec4(col, 1.0);
  ${fragmentDepth}
}
`;

// Lightweight overlay pass rendered after 3D pad/rocket meshes when camera is above
// the cloud base or inside rain/storm precipitation (using GreaterDepth so it only shades pixels occupied by 3D meshes).
export const cloudOverlayFragment = /* glsl */ `
${planetHeaderAndClouds}

void main() {
  #if CLOUD_STEPS > 0
  vec3 d = normalize(uWorldToEci * normalize(vDir));
  vec3 up = normalize(uCamUp);
  vec3 L = normalize(uSunDir);
  float h0 = max(uCamAlt, 0.5);
  float mu = dot(d, up);

  vec2 ground = raySphereH(h0, mu, 0.0);
  bool hitGround = ground.x < ground.y && ground.x > 0.0;
  bool hasRainOverlay = uWeather > 1.5 && h0 < CT + 380.0;
  if ((!hitGround && !hasRainOverlay) || (h0 <= CB && !hasRainOverlay)) discard;

  float tSurface = hitGround ? ground.x : 50000.0;
  float moonDist = max(length(uMoonRel), 1.0);
  vec3 moonDir = uMoonRel / moonDist;
  float moonAng = RM / moonDist;
  float sunAng = 0.00705;
  float sunMoonSep = length(L - moonDir);
  float transitProgress = smoothstep(abs(moonAng - sunAng) * 0.75, moonAng + sunAng, sunMoonSep);
  float transitFactor = mix(0.025, 1.0, pow(transitProgress, 1.35));

  vec4 cirrus = vec4(0.0, 0.0, 0.0, 1.0);
  vec4 cumulus = vec4(0.0, 0.0, 0.0, 1.0);
  if (hitGround && h0 > CB) {
    cirrus = sampleCirrus(up, h0, mu, d, L, tSurface, transitFactor);
    vec2 seg = cloudSegment(h0, mu, tSurface);
    float closestCloudT = 1e10;
    if (seg.x >= 0.0) {
      cumulus = marchClouds(up, h0, mu, d, L, seg, transitFactor, closestCloudT);
    }
  }

  vec4 rain = sampleRaindrops(d, up, L, h0, transitFactor);

  float T = cirrus.a * cumulus.a * (1.0 - rain.a);
  vec3 rgb = h0 < CIRRUS_H
    ? cirrus.rgb * cumulus.a + cumulus.rgb
    : cumulus.rgb * cirrus.a + cirrus.rgb;
  rgb = mix(rgb, rain.rgb, rain.a * 0.75);
  if (T > 0.995 && dot(rgb, rgb) < 1e-6) discard;
  gl_FragColor = vec4(rgb, clamp(1.0 - T, 0.0, 1.0));
  #else
  discard;
  #endif
  ${fragmentDepth}
}
`;
