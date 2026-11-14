// Atmospheric scattering shell. A small ray-marched single-scattering model
// (Rayleigh + Mie) written for this project, inspired by the classic technique
// often shown on Shadertoy. Gives the blue limb and orange light near the
// terminator. Units: Earth radius = 1.

import { fragmentDepth, fragmentHead, vertexHead, vertexTail } from "./common";

export const atmosphereVertex = /* glsl */ `
${vertexHead}
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  ${vertexTail}
}
`;

export const atmosphereFragment = /* glsl */ `
${fragmentHead}
uniform vec3 uSunDir;
uniform vec3 uCenter;
uniform float uPlanetRadius;
uniform float uAtmoRadius;
uniform float uSunIntensity;
varying vec3 vWorldPos;

#define VIEW_STEPS 16
#define LIGHT_STEPS 6

// The atmosphere is exaggerated in thickness so it reads at game scale, so the
// scale heights and coefficients are scaled to keep the colours believable.
const float H_R = 0.0075;   // Rayleigh scale height
const float H_M = 0.003;   // Mie scale height
const vec3 BETA_R = vec3(7.0, 16.6, 28.6);
const vec3 BETA_M = vec3(6.0);
const float G = 0.76;

vec2 raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float d = b * b - c;
  if (d < 0.0) return vec2(1e5, -1e5);
  d = sqrt(d);
  return vec2(-b - d, -b + d);
}

void main() {
  vec3 ro = cameraPosition - uCenter;
  vec3 rd = normalize(vWorldPos - cameraPosition);

  vec2 atmo = raySphere(ro, rd, uAtmoRadius);
  if (atmo.x > atmo.y || atmo.y < 0.0) discard;
  vec2 ground = raySphere(ro, rd, uPlanetRadius);

  float t0 = max(atmo.x, 0.0);
  float t1 = atmo.y;
  if (ground.x < ground.y && ground.x > 0.0) t1 = min(t1, ground.x);
  float ds = (t1 - t0) / float(VIEW_STEPS);

  vec3 L = normalize(uSunDir);
  float mu = dot(rd, L);

  vec3 sumR = vec3(0.0);
  vec3 sumM = vec3(0.0);
  float odR = 0.0;
  float odM = 0.0;

  for (int i = 0; i < VIEW_STEPS; i++) {
    vec3 pos = ro + rd * (t0 + (float(i) + 0.5) * ds);
    float h = length(pos) - uPlanetRadius;
    float dR = exp(-h / H_R) * ds;
    float dM = exp(-h / H_M) * ds;
    odR += dR;
    odM += dM;

    // Skip samples in the planet's shadow.
    vec2 shadow = raySphere(pos, L, uPlanetRadius);
    if (shadow.x < shadow.y && shadow.x > 0.0) continue;

    vec2 lightHit = raySphere(pos, L, uAtmoRadius);
    float dl = lightHit.y / float(LIGHT_STEPS);
    float lR = 0.0;
    float lM = 0.0;
    for (int j = 0; j < LIGHT_STEPS; j++) {
      vec3 q = pos + L * (float(j) + 0.5) * dl;
      float hq = max(length(q) - uPlanetRadius, 0.0);
      lR += exp(-hq / H_R) * dl;
      lM += exp(-hq / H_M) * dl;
    }
    vec3 tau = BETA_R * (odR + lR) + BETA_M * 1.1 * (odM + lM);
    vec3 att = exp(-tau);
    sumR += att * dR;
    sumM += att * dM;
  }

  float phaseR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float g2 = G * G;
  float phaseM = 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + mu * mu)) /
                 ((2.0 + g2) * pow(1.0 + g2 - 2.0 * G * mu, 1.5));

  vec3 col = uSunIntensity * (sumR * BETA_R * phaseR + sumM * BETA_M * phaseM);
  gl_FragColor = vec4(col, 1.0);
  ${fragmentDepth}
}
`;
