// Screen-space rain: water drops sitting and sliding on the camera "lens" (they
// refract the whole picture, rocket included) and close rain streaks in front of
// everything. The distant rain and the rain curtain stay in the planet shader.
// Original implementation; no third-party shader code.
//
// The flight scene writes the current rain strength, fall direction and light
// level into `rainState` every frame; this effect only reads it.

import { forwardRef, useImperativeHandle, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { BlendFunction, Effect } from "postprocessing";
import { Uniform, Vector2 } from "three";

export interface RainState {
  /** Strength of the falling streaks (0 = none, ~1 = rain, ~1.6 = storm). */
  streaks: number;
  /** Strength of the drops on the lens. */
  lens: number;
  /** Direction the rain falls on screen, in uv units (y up). */
  fall: Vector2;
  /** How much of the fall the camera sees: 1 looking level, near 0 looking straight down. */
  fallAmount: number;
  /** Camera yaw and pitch in radians, so the streaks stay put when the camera turns. */
  scroll: Vector2;
  /** How bright the streaks are (daylight, lightning). */
  light: number;
  high: boolean;
}

export const rainState: RainState = {
  streaks: 0,
  lens: 0,
  fall: new Vector2(0, -1),
  fallAmount: 1,
  scroll: new Vector2(),
  light: 0.3,
  high: true,
};

const fragment = /* glsl */ `
uniform float uStreaks;
uniform float uLens;
uniform float uTime;
uniform float uHigh;
uniform vec2 uFall;
uniform vec2 uScroll;
uniform float uLight;
uniform float uFallAmount;

float rh(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
vec2 rh2(vec2 p) {
  float a = rh(p);
  return vec2(a, rh(p + a + 17.0));
}

// Tiny droplets dotted over the lens. They form, sit, and evaporate.
// Returns a refraction offset (xy, uv units) and coverage (z).
vec3 tinyDroplets(vec2 uv, float t, float scale, float density, float seed) {
  vec2 p = vec2(uv.x * aspect, uv.y) * scale;
  vec2 id = floor(p);
  vec2 f = fract(p) - 0.5;
  vec2 r = rh2(id + seed);
  if (r.x > density) return vec3(0.0);
  vec2 c = (rh2(id + seed + 5.3) - 0.5) * 0.6;
  float life = fract(t * (0.05 + 0.1 * r.y) + r.x * 9.0);
  float size = (0.1 + 0.16 * r.y) * smoothstep(0.0, 0.1, life) * (1.0 - smoothstep(0.6, 1.0, life));
  vec2 dv = f - c;
  float d = length(dv);
  float m = smoothstep(size, size * 0.35, d);
  return vec3(dv / max(size, 1e-4) * m * 0.01, m);
}

// Drops running down the lens. The lens is cut into tall columns; in each cell a
// small drop slides down in stick-and-slip jerks and leaves a fading line of beads.
vec3 runningDrops(vec2 uv, float t, float scale, float density, float seed) {
  const float NARROW = 3.0; // cells are this many times taller than wide
  vec2 p = vec2(uv.x * aspect * scale * NARROW, uv.y * scale);
  float colRnd = rh(vec2(floor(p.x), seed));
  p.y += colRnd * 5.0; // stagger the columns
  vec2 id = floor(p);
  vec2 f = fract(p) - 0.5;
  float r = rh(id + seed * 3.1);
  if (r > density) return vec3(0.0);

  // Stick and slip: rest, then a quick slide, a few times per trip down the cell.
  float phase = t * (0.4 + 0.6 * r) + r * 20.0;
  float steps = floor(phase) + smoothstep(0.1, 1.0, fract(phase));
  float y = 0.45 - fract(steps * 0.21) * 0.95;
  float x = (rh(id + 9.7) - 0.5) * 0.45 + 0.05 * sin(steps * 2.7 + r * 6.0);

  // Distances in cell-height units (x is NARROW times smaller).
  vec2 dv = vec2((f.x - x) / NARROW, f.y - y);
  float size = 0.045 + 0.035 * r;
  dv.y *= 0.85;                     // a little flattened at the top
  float d = length(dv);
  float m = smoothstep(size, size * 0.3, d);

  // Line of tiny beads left above the drop, thinning out further up.
  float above = f.y - y;
  float bx = (f.x - x) / NARROW;
  float by = fract(f.y * 9.0 + r) - 0.5;
  float bead = smoothstep(0.018, 0.004, length(vec2(bx, by / 9.0)));
  bead *= step(0.0, above) * (1.0 - smoothstep(0.02, 0.28, above)) * step(0.62, rh(vec2(id.x, floor(f.y * 9.0 + r) + id.y * 17.0)));

  // Dome-shaped refraction: strongest towards the rim, zero in the middle and outside.
  float dome = m * (1.0 - m * 0.35);
  vec2 off = dv / max(size, 1e-4) * dome * 0.03 + vec2(bx, by / 9.0) / 0.018 * bead * 0.004;
  return vec3(off, max(m, bead * 0.5));
}

vec3 lensField(vec2 uv) {
  float t = uTime;
  float dens = clamp(uLens, 0.0, 1.8);
  vec3 run = runningDrops(uv, t, 4.0, 0.6 * dens, 1.0);
  vec3 tiny = tinyDroplets(uv, t, 34.0, 0.32 * dens, 3.0);
  vec3 more = vec3(0.0);
  if (uHigh > 0.5) more = runningDrops(uv, t * 0.8, 6.5, 0.35 * dens, 7.0);
  return vec3(run.xy + tiny.xy + more.xy, max(max(run.z, tiny.z), more.z));
}

void mainUv(inout vec2 uv) {
  if (uLens <= 0.001) return;
  uv += lensField(uv).xy;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 col = inputColor.rgb;

  if (uLens > 0.001) {
    vec3 lens = lensField(uv);
    // Water catches the light: a soft highlight towards the top of each drop.
    // Water on the glass: a faint dark rim where the drop curves away, a small
    // highlight on top where it catches the sky.
    float edge = lens.z * (1.0 - lens.z) * 4.0;
    float glint = clamp(-lens.y * 40.0, 0.0, 1.0) * lens.z;
    col = col * (1.0 - 0.18 * edge) + vec3(0.75, 0.8, 0.85) * uLight * glint * 0.35;
  }

  if (uStreaks > 0.001) {
    vec2 fall = normalize(uFall);
    vec2 side = vec2(-fall.y, fall.x);
    vec2 sp = uv * vec2(aspect, 1.0);
    vec2 p = vec2(dot(sp, side), -dot(sp, fall));
    float alpha = 0.0;
    int layers = uHigh > 0.5 ? 3 : 2;
    for (int i = 0; i < 3; i++) {
      if (i >= layers) break;
      float fi = float(i);
      // Near layers: fewer, thicker, faster streaks that move more when the camera turns.
      float cols = i == 0 ? 55.0 : (i == 1 ? 120.0 : 230.0);
      float parallax = i == 0 ? 1.4 : (i == 1 ? 0.8 : 0.45);
      float speed = i == 0 ? 2.6 : (i == 1 ? 2.0 : 1.5);
      // Looking down at the rain the streaks shorten to dashes and dots.
      float len = (i == 0 ? 0.12 : (i == 1 ? 0.08 : 0.05)) * mix(0.12, 1.0, uFallAmount);
      float width = i == 0 ? 0.1 : (i == 1 ? 0.08 : 0.065);
      float layerAlpha = i == 0 ? 0.26 : (i == 1 ? 0.19 : 0.13);
      vec2 q = p + vec2(uScroll.x, -uScroll.y) * parallax;
      float x = q.x * cols;
      float col_ = floor(x);
      float cr = rh(vec2(col_, fi * 13.1));
      float y = q.y + uTime * speed * (0.85 + 0.3 * cr) + cr * 10.0;
      float seg = y / (len * 2.2);
      float sid = floor(seg);
      float sf = fract(seg);
      float density = clamp(uStreaks * (i == 0 ? 0.32 : (i == 1 ? 0.42 : 0.55)), 0.0, 0.9);
      float exists = step(rh(vec2(col_, sid + fi * 31.0)), density);
      float dx = abs(fract(x) - 0.5 - (cr - 0.5) * 0.5);
      // Motion-blurred streak: bright head, tail fading out behind it.
      float a = smoothstep(width, width * 0.2, dx) * smoothstep(0.0, 0.08, sf) * pow(1.0 - smoothstep(0.08, 0.95, sf), 1.6);
      alpha += a * exists * layerAlpha;
    }
    alpha = clamp(alpha, 0.0, 1.0);
    // Rain lightens what is behind it a little and catches the ambient light.
    col += vec3(0.62, 0.68, 0.76) * uLight * alpha * 0.38;
    // Rainy-day grade: a bit less colour, a cool tint and gently softened contrast.
    float wet = clamp(uStreaks * 0.5, 0.0, 1.0);
    float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    vec3 graded = mix(col, vec3(luma), 0.22) * vec3(0.94, 0.98, 1.04);
    graded = mix(graded, vec3(luma), 0.06) * 0.97 + 0.01 * uLight;
    col = mix(col, graded, wet);
  }

  outputColor = vec4(col, inputColor.a);
}
`;

class RainLensEffect extends Effect {
  constructor() {
    super("RainLensEffect", fragment, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ["uStreaks", new Uniform(0)],
        ["uLens", new Uniform(0)],
        ["uTime", new Uniform(0)],
        ["uHigh", new Uniform(1)],
        ["uFall", new Uniform(new Vector2(0, -1))],
        ["uScroll", new Uniform(new Vector2())],
        ["uLight", new Uniform(0.3)],
        ["uFallAmount", new Uniform(1)],
      ]),
    });
  }
}

export const RainLens = forwardRef<RainLensEffect>(function RainLens(_, ref) {
  const effect = useMemo(() => new RainLensEffect(), []);
  useImperativeHandle(ref, () => effect, [effect]);
  useFrame((state, dt) => {
    const u = effect.uniforms;
    const k = Math.min(1, dt * 1.5); // ease in and out of the rain
    const cur = u.get("uStreaks")!;
    cur.value += (rainState.streaks - cur.value) * k;
    const lens = u.get("uLens")!;
    lens.value += (rainState.lens - lens.value) * k;
    u.get("uTime")!.value = state.clock.elapsedTime;
    u.get("uHigh")!.value = rainState.high ? 1 : 0;
    (u.get("uFall")!.value as Vector2).lerp(rainState.fall, Math.min(1, dt * 4));
    (u.get("uScroll")!.value as Vector2).copy(rainState.scroll);
    u.get("uLight")!.value = rainState.light;
    const fa = u.get("uFallAmount")!;
    fa.value += (rainState.fallAmount - fa.value) * Math.min(1, dt * 4);
  });
  return <primitive object={effect} dispose={null} />;
});
