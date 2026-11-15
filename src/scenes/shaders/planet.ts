// The whole world beyond the rocket, drawn per pixel on a sphere around the
// camera: the Earth (oceans, continents, the coast at the launch site, clouds,
// city lights), its atmosphere (Rayleigh + Mie single scattering), the Moon,
// the Sun and the stars. Everything is analytic ray casting at real scale, so
// the view changes continuously from the pad to lunar distance with no switch.
// Original implementation; visual style inspired by community Minecraft shader
// packs. No third-party code. Techniques are the standard published ones:
// single-scattering atmosphere, ray-marched volumetric clouds with Beer-Lambert
// and a powder term, sum-of-sines ocean waves with Fresnel reflection.
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
uniform float uTime;      // mission time (clouds drift with time warp)
uniform float uRealTime;  // wall-clock time (waves keep moving on the pad)
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
const float BETA_M = 16e-6;
const float G = 0.8;
const float CB = 1500.0; // cloud base
const float CT = 4200.0; // cloud tops
#ifndef CLOUD_STEPS
#define CLOUD_STEPS 12
#endif
#ifndef CLOUD_LIGHT
#define CLOUD_LIGHT 2
#endif

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
vec3 nearAlbedo(vec2 p, float dist, out float water, out float coastDist) {
  float coastX = 1800.0 + 900.0 * (fbm(vec3(p.y / 6000.0, 0.0, 3.0), 4) - 0.5) * 2.0;
  float coast = p.x - coastX;
  coastDist = coast;
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

// Large-scale weather: where the cloud systems are, 0..1.
float weatherCover(vec3 nf, float padDist) {
  vec3 q = nf * 5.0 + vec3(uTime * 0.00002, 0.0, 0.0);
  float c = fbm(q + fbm(q * 2.0 + 3.1, 3) * 1.2, 4);
  float cover = smoothstep(0.42, 0.68, c);
  // Fair weather over the launch site: scattered cumulus, never overcast.
  return mix(cover, 0.33, 1.0 - smoothstep(20000.0, 140000.0, padDist));
}

// Cloud density at an Earth-fixed point pk (km) and height h (m).
float cloudDensity(vec3 pk, float h, float cover) {
  float hf = clamp((h - CB) / (CT - CB), 0.0, 1.0);
  // Flat bases, rounded tops.
  float profile = smoothstep(0.0, 0.07, hf) * (1.0 - smoothstep(0.3, 1.0, hf));
  vec3 q = pk + vec3(uTime * 0.008, 0.0, uTime * 0.003);
  float shape = fbm(q * 0.38, 4);
  float d = shape * profile - (1.0 - cover) * 0.72;
  if (d <= 0.0) return 0.0;
  // Erode the edges with finer noise for billowy shapes.
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

// Ray-marched cumulus. Returns light scattered towards the camera (rgb) and transmittance (a).
vec4 marchClouds(vec3 up, float h0, float mu, vec3 d, vec3 L, vec2 seg) {
  float span = seg.y - seg.x;
  float tMid = seg.x + span * 0.3;
  vec3 nMid = normalize(up * (R + h0) + d * tMid);
  float cover = weatherCover(toEcef(nMid), length(uCamFromPad + d * tMid));
  if (cover < 0.04) return vec4(0.0, 0.0, 0.0, 1.0);

  float muS = dot(nMid, L);
  vec3 sunCol = uSunIntensity * extinction(sunDepth(2500.0, muS)) * step(-0.08, muS);
  vec3 ambient = uSunIntensity * vec3(0.035, 0.055, 0.09) * (0.01 + 0.99 * smoothstep(-0.12, 0.3, muS));
  float cosT = dot(d, L);
  // Strong forward lobe gives the bright silver lining around the Sun.
  float phase = mix(hg(0.7, cosT), hg(-0.25, cosT), 0.35) * 2.8;
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
    // Light reaching this point from the Sun through the cloud above it.
    float odL = 0.0;
    for (int j = 0; j < CLOUD_LIGHT; j++) {
      float dist = j == 0 ? 220.0 : 800.0;
      odL += cloudDensity(pk + Lf * (dist / 1000.0), h + dot(n, L) * dist, cover) * (j == 0 ? 220.0 : 580.0);
    }
    float sigma = 0.01;
    float Tl = exp(-odL * sigma);
    float powder = 1.0 - exp(-dens * sigma * 400.0);
    float hf = clamp((h - CB) / (CT - CB), 0.0, 1.0);
    vec3 S = sunCol * Tl * phase * (0.35 + 0.65 * powder) + ambient * (0.55 + 0.45 * hf);
    float stepT = exp(-dens * sigma * ds);
    acc += T * S * (1.0 - stepT);
    T *= stepT;
    if (T < 0.02) break;
  }
  return vec4(acc, T);
}

// Ocean wave slopes from a sum of directional waves, in the pad's local frame (metres).
vec2 waveSlope(vec2 p, float time) {
  vec2 g = vec2(0.0);
  vec2 dirs[4];
  dirs[0] = normalize(vec2(1.0, 0.3));
  dirs[1] = normalize(vec2(-0.4, 1.0));
  dirs[2] = normalize(vec2(0.8, -0.6));
  dirs[3] = normalize(vec2(0.25, 0.95));
  float lens[4];
  lens[0] = 41.0;
  lens[1] = 23.0;
  lens[2] = 13.0;
  lens[3] = 7.0;
  for (int i = 0; i < 4; i++) {
    float k = 2.0 * PI / lens[i];
    float w = sqrt(9.81 * k);
    float a = 0.09 / k; // gentle steepness
    float ph = dot(dirs[i], p) * k - w * time;
    g += dirs[i] * (a * k * cos(ph));
  }
  return g;
}

// Water: depth-tinted body colour, Fresnel reflection of the sky, sun glint, foam.
vec3 shadeWater(vec3 n, vec3 d, vec3 L, vec3 sunT, float dist, vec2 local, float coastDist, float nearW, float h0) {
  // Waves only near the coast where we have the local frame, fading with distance.
  vec2 slope = nearW > 0.0 ? waveSlope(local, uRealTime) * nearW * (1.0 - smoothstep(300.0, 15000.0, dist)) : vec2(0.0);
  vec3 nw = normalize(n - uPadEast * slope.x - uPadNorth * slope.y);
  float cosV = max(dot(nw, -d), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
  vec3 r = reflect(d, nw);
  float elev = dot(r, n);
  float day = smoothstep(-0.12, 0.25, dot(n, L));
  vec3 skyRefl = uSunIntensity * mix(vec3(0.06, 0.08, 0.10), vec3(0.012, 0.035, 0.11), smoothstep(0.0, 0.5, elev)) * day;
  // Sharper glint up close, broader from orbit.
  float rough = mix(1800.0, 90.0, smoothstep(2000.0, 400000.0, h0));
  float spec = pow(max(dot(r, L), 0.0), rough) * mix(60.0, 0.35, smoothstep(2000.0, 400000.0, h0));
  // Turquoise shallows near the beach, deep blue offshore.
  float shallow = nearW * (1.0 - smoothstep(0.0, 220.0, coastDist));
  vec3 body = mix(vec3(0.004, 0.022, 0.045), vec3(0.02, 0.13, 0.12), shallow);
  float ndl = max(dot(n, L), 0.0);
  vec3 col = body * uSunIntensity * sunT * (ndl * 0.25 + 0.05) * (1.0 - F) + skyRefl * F + uSunIntensity * sunT * spec;
  // Foam where the waves break on the beach.
  if (nearW > 0.0) {
    float surf = (1.0 - smoothstep(0.0, 28.0, coastDist)) * smoothstep(-6.0, 0.0, coastDist);
    float pattern = fbm(vec3(local * 0.12, uRealTime * 0.3), 3);
    float foam = surf * smoothstep(0.42, 0.62, pattern + 0.25 * sin(coastDist * 0.5 - uRealTime * 1.5)) * nearW;
    col = mix(col, vec3(0.8) * uSunIntensity * sunT * (ndl * 0.3 + 0.08), foam * 0.85);
  }
  return col;
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
    float wNear = 1.0 - smoothstep(30000.0, 120000.0, padDist);
    float water = waterFar;
    float coastDist = 1e5;
    if (wNear > 0.0) {
      float waterNear;
      vec3 albedoNear = nearAlbedo(local, t, waterNear, coastDist);
      albedo = mix(albedo, albedoNear, wNear);
      water = mix(waterFar, waterNear, wNear);
    }
    float ndl = dot(n, L);
    vec3 sunT = extinction(sunDepth(0.0, ndl));

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
    vec3 skyLight = uSunIntensity * vec3(0.012, 0.022, 0.045) * smoothstep(-0.1, 0.3, ndl);
    vec3 landCol = albedo * (sunLight + skyLight);
    float night = 1.0 - smoothstep(-0.15, 0.05, ndl);
    float cities = (1.0 - water) * smoothstep(0.5, 0.62, fbm(nf * 5.0 + 11.0, 3)) * smoothstep(0.62, 0.85, fbm(nf * 60.0, 3));
    landCol += vec3(1.0, 0.6, 0.25) * cities * night * 0.02 * uSunIntensity;
    vec3 seaCol = shadeWater(n, d, L, sunT * shadow, t, local, coastDist, wNear, h0);
    col = mix(landCol, seaCol, clamp(water, 0.0, 1.0)) * viewT + inscatter;
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
    // Sun disc and a soft warm aureole around it.
    float sunDisc = smoothstep(0.99997, 0.99999, nu);
    col += sunDisc * uSunIntensity * 40.0 * viewT;
    col += uSunIntensity * viewT * vec3(1.0, 0.85, 0.65) * pow(max(nu, 0.0), 900.0) * 0.6;
    float skyLum = dot(inscatter, vec3(0.2126, 0.7152, 0.0722));
    col += stars(d) * exp(-skyLum * 40.0) * 1.5;
  }

  // Volumetric clouds in front of whatever is behind them.
  #if CLOUD_STEPS > 0
  vec2 seg = cloudSegment(h0, mu, tSurface);
  if (seg.x >= 0.0) {
    vec4 c = marchClouds(up, h0, mu, d, L, seg);
    float alpha = 1.0 - c.a;
    if (alpha > 0.001) {
      // Distant clouds fade into the haze (aerial perspective).
      float tC = seg.x + (seg.y - seg.x) * 0.3;
      float haze = (1.0 - exp(-tC / 45000.0)) * (1.0 - smoothstep(CT, 20000.0, h0));
      vec3 cloudCol = mix(c.rgb, inscatter * alpha, haze * 0.85);
      col = col * c.a + cloudCol;
    }
  }
  #endif

  gl_FragColor = vec4(col, 1.0);
  ${fragmentDepth}
}
`;
