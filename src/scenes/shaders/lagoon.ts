// Small water shader for the lagoons around the pad: a few moving wave trains
// give the normal, fresnel mixes deep water with the sky, plus a sun glint.
// Works in world space so it tiles seamlessly across separate lagoons.

export const lagoonVertex = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const lagoonFragment = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSky;
varying vec3 vWorld;

// sum of directional waves; returns the height gradient (d/dx, d/dz)
vec2 waveGrad(vec2 p, float t) {
  vec2 g = vec2(0.0);
  const int N = 5;
  for (int i = 0; i < N; i++) {
    float fi = float(i);
    float a = fi * 2.399 + 0.6;
    vec2 d = vec2(cos(a), sin(a));
    float k = 0.18 * pow(1.55, fi);
    float amp = 0.55 / (1.0 + fi * 1.3);
    float ph = dot(d, p) * k + t * sqrt(9.8 * k) * 0.6;
    g += d * k * amp * cos(ph);
  }
  return g;
}

void main() {
  vec2 g = waveGrad(vWorld.xz, uTime);
  vec3 N = normalize(vec3(-g.x * 0.35, 1.0, -g.y * 0.35));
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 L = normalize(uSunDir);
  float ndv = max(dot(N, V), 0.0);
  float fres = 0.03 + 0.97 * pow(1.0 - ndv, 5.0);
  float day = smoothstep(-0.15, 0.25, L.y);
  vec3 skyCol = mix(vec3(0.008, 0.015, 0.032), uSky, day);
  vec3 body = mix(uDeep, uShallow, 0.35 + 0.25 * N.x);
  vec3 col = mix(body, skyCol, fres);
  vec3 H = normalize(L + V);
  col += vec3(1.0, 0.92, 0.78) * pow(max(dot(N, H), 0.0), 220.0) * 3.0 * smoothstep(-0.04, 0.08, L.y);
  col *= mix(0.025, 1.0, 0.35 * day + 0.65 * smoothstep(-0.05, 0.45, L.y));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
