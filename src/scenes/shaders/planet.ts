// The whole world beyond the rocket, drawn per pixel on a sphere around the
// camera: the Earth (oceans, continents, the coast at the launch site, clouds,
// city lights), its atmosphere (Rayleigh + Mie single scattering), the Moon,
// the Sun and the stars. Everything is analytic ray casting at real scale, so
// the view changes continuously from the pad to lunar distance with no switch.
// Original code, inspired by common Shadertoy planet and sky techniques.
//
// Frame: ECI (the physics frame). The camera's altitude and position relative
// to the pad and the Moon are computed on the CPU in double precision and
// passed in as small numbers, so float precision holds up at every scale.

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
uniform float uTime;
uniform float uSunIntensity;
varying vec3 vDir;

#ifndef VIEW_STEPS
#define VIEW_STEPS 12
#endif
#ifndef LIGHT_STEPS
#define LIGHT_STEPS 4
#endif

const float R = ${R_EARTH.toFixed(1)};
const float RM = ${R_MOON.toFixed(1)};
const float HA = 100000.0;
const float HR = 8000.0;
const float HM = 1200.0;
const float CLOUD_H = 3000.0;
const vec3 BETA_R = vec3(5.8e-6, 13.5e-6, 33.1e-6);
const float BETA_M = 21e-6;
const float G = 0.76;

${noiseGLSL}

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

vec2 sunDepth(float h, float muS) {
  vec2 ground = raySphereH(h, muS, 0.0);
  if (ground.x < ground.y && ground.x > 0.0) return vec2(1e9);
  float len = raySphereH(h, muS, HA).y;
  if (len <= 0.0) return vec2(0.0);
  float dl = len / float(LIGHT_STEPS);
  vec2 od = vec2(0.0);
  for (int j = 0; j < LIGHT_STEPS; j++) {
    float hj = max(heightAt(h, muS, (float(j) + 0.5) * dl), 0.0);
    od += vec2(exp(-hj / HR), exp(-hj / HM)) * dl;
  }
  return od;
}

vec3 extinction(vec2 od) {
  return exp(-(BETA_R * od.x + BETA_M * 1.1 * od.y));
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
  // Make sure there is land around and west of the pad.
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
vec3 nearAlbedo(vec2 p, float dist, out float water) {
  float coastX = 1800.0 + 900.0 * (fbm(vec3(p.y / 6000.0, 0.0, 3.0), 4) - 0.5) * 2.0;
  float coast = p.x - coastX;
  water = smoothstep(-5.0, 5.0, coast);
  float big = fbm(vec3(p / 2200.0, 1.0), 4);
  float small = fbm(vec3(p / 180.0, 2.0), 3);
  vec3 scrub = vec3(0.045, 0.06, 0.025);
  vec3 grass = vec3(0.075, 0.09, 0.035);
  vec3 dry = vec3(0.13, 0.115, 0.075);
  vec3 land = mix(mix(scrub, grass, smoothstep(0.4, 0.6, big)), dry, smoothstep(0.55, 0.75, small) * 0.5);
  land = mix(land, mix(scrub, grass, 0.5), smoothstep(3000.0, 15000.0, dist) * 0.6);
  land = mix(vec3(0.075, 0.09, 0.035), land, smoothstep(250.0, 400.0, length(p)));
  vec3 sand = vec3(0.42, 0.38, 0.30);
  land = mix(land, sand, 1.0 - smoothstep(0.0, 70.0, abs(coast + 35.0)));
  vec3 sea = mix(vec3(0.006, 0.03, 0.05), vec3(0.01, 0.05, 0.07), 1.0 - smoothstep(0.0, 900.0, coast));
  return mix(land, sea, water);
}

float cloudCover(vec3 n, float padDist) {
  vec3 q = n * 6.0 + vec3(uTime * 0.0004, 0.0, 0.0);
  vec3 w = vec3(fbm(q + 1.3, 3), fbm(q + 7.1, 3), fbm(q + 3.7, 3));
  float c = fbm(q * 1.7 + w * 1.6, 5);
  float cover = smoothstep(0.52, 0.72, c);
  // Clear weather over the launch site.
  return cover * smoothstep(25000.0, 90000.0, padDist);
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
  // Faint Milky Way band.
  vec3 galN = normalize(vec3(0.3, 0.35, 0.9));
  float band = exp(-pow(dot(d, galN) / 0.16, 2.0));
  col += vec3(0.55, 0.6, 0.8) * band * fbm(d * 6.0, 4) * 0.03;
  return col;
}

void main() {
  vec3 d = normalize(uWorldToEci * normalize(vDir));
  vec3 up = normalize(uCamUp);
  vec3 L = normalize(uSunDir);
  float h0 = max(uCamAlt, 0.5);
  float mu = dot(d, up);
  float nu = dot(d, L);

  vec2 atmo = raySphereH(h0, mu, HA);
  vec2 ground = raySphereH(h0, mu, 0.0);
  bool hitGround = ground.x < ground.y && ground.x > 0.0;

  // Moon.
  float bM = dot(d, uMoonRel);
  float cM = dot(uMoonRel, uMoonRel) - RM * RM;
  float discM = bM * bM - cM;
  float tMoon = -1.0;
  if (discM > 0.0) {
    float t = bM - sqrt(discM);
    if (t > 0.0) tMoon = t;
  }
  bool hitMoon = tMoon > 0.0 && (!hitGround || tMoon < ground.x);
  if (hitMoon) hitGround = false;

  vec3 inscatter = vec3(0.0);
  vec3 viewT = vec3(1.0);
  float tEnd = hitGround ? ground.x : atmo.y;
  float tStart = max(atmo.x, 0.0);
  if (atmo.x < atmo.y && atmo.y > 0.0 && tEnd > tStart) {
    float span = tEnd - tStart;
    vec2 odView = vec2(0.0);
    vec3 sumR = vec3(0.0);
    vec3 sumM = vec3(0.0);
    for (int i = 0; i < VIEW_STEPS; i++) {
      float u = (float(i) + 0.5) / float(VIEW_STEPS);
      float t = tStart + span * u * u;
      float ds = span * 2.0 * u / float(VIEW_STEPS);
      float h = max(heightAt(h0, mu, t), 0.0);
      vec2 dens = vec2(exp(-h / HR), exp(-h / HM)) * ds;
      odView += dens;
      vec3 upS = normalize(up * (R + h0) + d * t);
      vec2 odSun = sunDepth(h, dot(upS, L));
      if (odSun.x > 1e8) continue;
      vec3 T = extinction(odView + odSun);
      sumR += T * dens.x;
      sumM += T * dens.y;
    }
    float phaseR = 3.0 / (16.0 * PI) * (1.0 + nu * nu);
    float g2 = G * G;
    float phaseM = 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + nu * nu)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * G * nu, 1.5));
    inscatter = uSunIntensity * (sumR * BETA_R * phaseR + sumM * BETA_M * phaseM);
    viewT = extinction(odView);
  }

  vec3 col;
  if (hitGround) {
    float t = ground.x;
    vec3 n = normalize(up * (R + h0) + d * t);
    vec3 nf = toEcef(n);
    // Position of the ground point relative to the pad, for local detail.
    vec3 fromPad = uCamFromPad + d * t;
    vec2 local = vec2(dot(fromPad, uPadEast), dot(fromPad, uPadNorth));
    float padDist = length(fromPad);
    float waterFar;
    float heightFar;
    vec3 albedoFar = globalAlbedo(nf, waterFar, heightFar);
    float wNear = 1.0 - smoothstep(30000.0, 120000.0, padDist);
    vec3 albedo = albedoFar;
    float water = waterFar;
    if (wNear > 0.0) {
      float waterNear;
      vec3 albedoNear = nearAlbedo(local, t, waterNear);
      albedo = mix(albedoFar, albedoNear, wNear);
      water = mix(waterFar, waterNear, wNear);
    }
    float ndl = dot(n, L);
    vec3 sunT = extinction(sunDepth(0.0, ndl));
    vec3 sunLight = uSunIntensity * sunT * max(ndl, 0.0) / PI;
    vec3 skyLight = uSunIntensity * vec3(0.012, 0.022, 0.045) * smoothstep(-0.1, 0.3, ndl);
    vec3 g = albedo * (sunLight + skyLight);
    vec3 hv = normalize(L - d);
    // Sun glint on water: sharp up close, broader but dimmer seen from orbit.
    float rough = mix(600.0, 120.0, smoothstep(2000.0, 400000.0, h0));
    g += water * uSunIntensity * sunT * pow(max(dot(n, hv), 0.0), rough) * mix(4.0, 0.25, smoothstep(2000.0, 400000.0, h0));
    // City lights on the night side.
    float night = 1.0 - smoothstep(-0.15, 0.05, ndl);
    float cities = (1.0 - water) * smoothstep(0.5, 0.62, fbm(nf * 5.0 + 11.0, 3)) * smoothstep(0.62, 0.85, fbm(nf * 60.0, 3));
    g += vec3(1.0, 0.6, 0.25) * cities * night * 0.02 * uSunIntensity;

    // Clouds between the camera and the ground.
    vec2 cl = raySphereH(h0, mu, CLOUD_H);
    float tc = h0 > CLOUD_H ? cl.x : cl.y;
    if (tc > 0.0 && tc < t) {
      vec3 nc = normalize(up * (R + h0) + d * tc);
      float cover = cloudCover(toEcef(nc), length(uCamFromPad + d * tc));
      float cl_ndl = dot(nc, L);
      vec3 cloudCol = vec3(0.9) * (uSunIntensity * extinction(sunDepth(CLOUD_H, cl_ndl)) * max(cl_ndl, 0.0) / PI + skyLight * 2.0);
      g = mix(g, cloudCol, cover * 0.9);
    }
    col = g * viewT + inscatter;
  } else if (hitMoon) {
    vec3 p = d * tMoon - uMoonRel;
    vec3 n = normalize(p);
    vec3 albedo = moonAlbedo(n);
    float ndl = max(dot(n, L), 0.0);
    float ndv = max(dot(n, -d), 0.0);
    float ls = ndl / (ndl + ndv + 1e-4) * 2.0;
    col = albedo * uSunIntensity * mix(ndl, ls, 0.6) / PI * viewT + inscatter;
  } else {
    col = inscatter;
    // Clouds overhead when looking up from below them.
    vec2 cl = raySphereH(h0, mu, CLOUD_H);
    if (h0 < CLOUD_H && cl.y > 0.0) {
      vec3 nc = normalize(up * (R + h0) + d * cl.y);
      float cover = cloudCover(toEcef(nc), length(uCamFromPad + d * cl.y));
      float cl_ndl = dot(nc, L);
      vec3 cloudCol = vec3(0.92) * uSunIntensity * (max(cl_ndl, 0.0) / PI * 0.8 + 0.03);
      col = mix(col, cloudCol, cover * 0.85 * smoothstep(0.0, 0.08, mu));
    }
    float sunDisc = smoothstep(0.99997, 0.99999, nu);
    col += sunDisc * uSunIntensity * 40.0 * viewT;
    float skyLum = dot(inscatter, vec3(0.2126, 0.7152, 0.0722));
    col += stars(d) * exp(-skyLum * 40.0) * 1.5;
  }

  gl_FragColor = vec4(col, 1.0);
  ${fragmentDepth}
}
`;
