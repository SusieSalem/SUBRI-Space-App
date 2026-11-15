// Top-down radar-style minimap of the mission trajectory.
// Reuses the same path points and clock as the 3D scene.

import { useEffect, useMemo, useRef } from "react";
import type { MissionClock } from "../scenes/SpaceScene";
import {
  EARTH_RADIUS,
  MOON_POSITION,
  MOON_RADIUS,
  PARKING_ORBIT_RADIUS,
  PHASES,
  missionStateAt,
  newMissionState,
  plannedPathPoints,
} from "../scenes/mission";

interface Props {
  clock: React.MutableRefObject<MissionClock>;
  phaseLabel: string;
}

const MARGIN = 0.08;
// Scale factor applied to the visual disks of Earth and Moon only, so they
// read clearly as bodies rather than dots. The trajectory itself stays in its
// original scale.
const BODY_DISPLAY_SCALE = 2;
const EARTH_DISPLAY_R = EARTH_RADIUS * BODY_DISPLAY_SCALE;
const MOON_DISPLAY_R = MOON_RADIUS * BODY_DISPLAY_SCALE;

// Earth grew in the minimap but its parking orbit (r ≈ 1.07) would end up
// buried inside the disk. Push trajectory points radially outward with a bump
// that decays exponentially — the parking orbit clears the enlarged Earth,
// the early coast reads as a clear "lift-off" away from the planet, and the
// trans-lunar segment near the Moon is left untouched. The product
// PUSH_MAX*PUSH_FALLOFF must stay <= 1 for the mapping to be monotonic.
const PUSH_MAX = 1.8;
const PUSH_FALLOFF = 0.5;

function displaceRadialW(x: number, z: number, weight: number): [number, number] {
  const d = Math.hypot(x, z);
  if (d < 1e-4) return [x, z];
  const push = PUSH_MAX * weight * Math.exp(-(d - EARTH_RADIUS) * PUSH_FALLOFF);
  const scale = (d + push) / d;
  return [x * scale, z * scale];
}

// Number of trailing transfer-curve points over which the outward push tapers
// to zero, so the re-entry dives into Earth instead of orbiting its edge.
const REENTRY_TAPER_POINTS = 40;

// The parking orbit from plannedPathPoints is a flat circle, which doesn't
// read as a launch. Replace it with a spiral that starts on Earth's surface
// and climbs out to meet the (displaced) start of the transfer curve.
const PARKING_SWEEP_LAUNCH = 0.9; // matches the value hard-coded in mission.ts
const SPIRAL_SWEEP = 2 * Math.PI + PARKING_SWEEP_LAUNCH;
const SPIRAL_START_ANGLE = -SPIRAL_SWEEP; // angle 0 is where the transfer curve begins
const SPIRAL_END_R = (() => {
  const d = PARKING_ORBIT_RADIUS;
  const push = PUSH_MAX * Math.exp(-(d - EARTH_RADIUS) * PUSH_FALLOFF);
  return d + push; // ≈ 2.81 — matches the displaced transfer curve start
})();
const SPIRAL_POINTS = 120;

// Durations of the three phases the spiral represents (launch + parking + TLI).
const LAUNCH_DUR = PHASES.find((p) => p.id === "launch")!.duration;
const PARKING_DUR = PHASES.find((p) => p.id === "parking")!.duration;
const TLI_DUR = PHASES.find((p) => p.id === "tli")!.duration;
const SPIRAL_END_T = LAUNCH_DUR + PARKING_DUR + TLI_DUR;

function spiralAt(progress: number): [number, number] {
  const p = Math.max(0, Math.min(1, progress));
  const angle = SPIRAL_START_ANGLE + SPIRAL_SWEEP * p;
  const r = EARTH_DISPLAY_R + (SPIRAL_END_R - EARTH_DISPLAY_R) * p;
  // onCircle convention in mission.ts: pos = U*cos*r + V*sin*r, U=(0,0,1), V=(1,0,0)
  return [Math.sin(angle) * r, Math.cos(angle) * r];
}

export default function TrajectoryMap({ clock, phaseLabel }: Props) {
  // All geometry is computed once — the shape of the planned path is static.
  const geometry = useMemo(() => {
    const pts: { x: number; z: number }[] = [];

    // Launch + parking + TLI: a visible spiral climbing out of Earth.
    for (let i = 0; i <= SPIRAL_POINTS; i++) {
      const [x, z] = spiralAt(i / SPIRAL_POINTS);
      pts.push({ x, z });
    }

    // Trans-lunar transfer curve, displaced radially so the inner leg reads
    // clearly outside the enlarged Earth. plannedPathPoints packs 65 parking-
    // orbit points followed by the transfer curve; we replaced the parking
    // portion with the spiral above, so skip it. The final points taper the
    // displacement to 0 so the re-entry dives back into the planet.
    const raw = plannedPathPoints();
    for (let i = 65; i < raw.length; i++) {
      const fromEnd = raw.length - 1 - i;
      const weight =
        fromEnd >= REENTRY_TAPER_POINTS ? 1 : fromEnd / REENTRY_TAPER_POINTS;
      const [x, z] = displaceRadialW(raw[i].x, raw[i].z, weight);
      pts.push({ x, z });
    }

    // Bounding box in the X–Z plane, plus Earth and Moon extents.
    let minX = -EARTH_DISPLAY_R;
    let maxX = EARTH_DISPLAY_R;
    let minZ = -EARTH_DISPLAY_R;
    let maxZ = EARTH_DISPLAY_R;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    minX = Math.min(minX, MOON_POSITION.x - MOON_DISPLAY_R);
    maxX = Math.max(maxX, MOON_POSITION.x + MOON_DISPLAY_R);
    minZ = Math.min(minZ, MOON_POSITION.z - MOON_DISPLAY_R);
    maxZ = Math.max(maxZ, MOON_POSITION.z + MOON_DISPLAY_R);

    const padX = (maxX - minX) * MARGIN;
    const padZ = (maxZ - minZ) * MARGIN;
    const vbMinX = minX - padX;
    const vbMinZ = minZ - padZ;
    const vbW = maxX - minX + 2 * padX;
    const vbH = maxZ - minZ + 2 * padZ;

    // Cumulative arc length along the planned path, used to paint the
    // "already travelled" segment with stroke-dasharray.
    const cum: number[] = new Array(pts.length);
    cum[0] = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x;
      const dz = pts[i].z - pts[i - 1].z;
      cum[i] = cum[i - 1] + Math.hypot(dx, dz);
    }
    const total = cum[cum.length - 1];

    const d =
      "M " +
      pts
        .map((p) => `${p.x.toFixed(4)} ${p.z.toFixed(4)}`)
        .join(" L ");

    return {
      viewBox: `${vbMinX} ${vbMinZ} ${vbW} ${vbH}`,
      scale: Math.min(1 / vbW, 1 / vbH), // only used for stroke width heuristic
      pts,
      cum,
      total,
      d,
    };
  }, []);

  const svgRef = useRef<SVGSVGElement>(null);
  const travelledRef = useRef<SVGPathElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);
  const dotRingRef = useRef<SVGCircleElement>(null);
  const scratch = useMemo(() => newMissionState(), []);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = clock.current.time;

      // During launch/parking/TLI the dot rides the synthetic spiral so it
      // actually appears to lift off from the planet. After TLI it follows
      // the simulation, displaced to match the drawn transfer curve — with
      // the displacement tapering to 0 during re-entry/splashdown so the dot
      // lands on the planet instead of grazing its edge.
      let px: number;
      let pz: number;
      if (t <= 0) {
        [px, pz] = spiralAt(0);
      } else if (t < SPIRAL_END_T) {
        [px, pz] = spiralAt(t / SPIRAL_END_T);
      } else {
        missionStateAt(t, scratch);
        let weight = 1;
        if (scratch.phase === "reentry") {
          weight = 1 - scratch.phaseProgress;
        } else if (scratch.phase === "splashdown") {
          weight = 0;
        }
        [px, pz] = displaceRadialW(scratch.position.x, scratch.position.z, weight);
      }

      if (dotRef.current) {
        dotRef.current.setAttribute("cx", px.toFixed(4));
        dotRef.current.setAttribute("cy", pz.toFixed(4));
      }
      if (dotRingRef.current) {
        dotRingRef.current.setAttribute("cx", px.toFixed(4));
        dotRingRef.current.setAttribute("cy", pz.toFixed(4));
      }

      // Travelled length: nearest planned point to the current position. The
      // simulation path doesn't match the planned path 1:1 during launch and
      // parking, but on a minimap this is more than close enough.
      if (travelledRef.current) {
        let bestIdx = 0;
        let bestD = Infinity;
        for (let i = 0; i < geometry.pts.length; i++) {
          const q = geometry.pts[i];
          const d2 = (q.x - px) * (q.x - px) + (q.z - pz) * (q.z - pz);
          if (d2 < bestD) {
            bestD = d2;
            bestIdx = i;
          }
        }
        const travelled = t <= 0 ? 0 : geometry.cum[bestIdx];
        const rest = Math.max(geometry.total - travelled, 0);
        travelledRef.current.setAttribute(
          "stroke-dasharray",
          `${travelled} ${rest}`,
        );
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [clock, geometry, scratch]);

  // Stroke width in viewBox units so lines look thin regardless of card size.
  const strokeW = Math.max(geometry.viewBox.split(" ").map(Number)[2], 1) * 0.004;
  const dash = strokeW * 2.5;
  const gap = strokeW * 2;
  const earthR = EARTH_DISPLAY_R;
  const moonR = MOON_DISPLAY_R;

  return (
    <aside className="map-card">
      <div className="map-header">
        <span className="label">Trajectory</span>
      </div>
      <svg
        ref={svgRef}
        viewBox={geometry.viewBox}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <radialGradient id="tm-earth" cx="35%" cy="32%" r="68%">
            <stop offset="0%" stopColor="#3a7dc2" />
            <stop offset="45%" stopColor="#13406e" />
            <stop offset="80%" stopColor="#061a34" />
            <stop offset="100%" stopColor="#02081a" />
          </radialGradient>
          <radialGradient id="tm-atm" cx="50%" cy="50%" r="50%">
            <stop offset="86%" stopColor="rgba(95,168,255,0)" />
            <stop offset="96%" stopColor="rgba(95,168,255,0.45)" />
            <stop offset="100%" stopColor="rgba(95,168,255,0)" />
          </radialGradient>
          <radialGradient id="tm-terminator" cx="28%" cy="28%" r="90%">
            <stop offset="35%" stopColor="rgba(0,0,0,0)" />
            <stop offset="72%" stopColor="rgba(0,0,0,0.35)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.78)" />
          </radialGradient>
          <radialGradient id="tm-moon" cx="32%" cy="30%" r="72%">
            <stop offset="0%" stopColor="#d4d4dc" />
            <stop offset="55%" stopColor="#6a6a74" />
            <stop offset="100%" stopColor="#1a1a22" />
          </radialGradient>
          <clipPath id="tm-earth-clip" clipPathUnits="userSpaceOnUse">
            <circle cx={0} cy={0} r={earthR} />
          </clipPath>
          <clipPath id="tm-moon-clip" clipPathUnits="userSpaceOnUse">
            <circle cx={MOON_POSITION.x} cy={MOON_POSITION.z} r={moonR} />
          </clipPath>
        </defs>

        {/* Planned path — dashed, faint. Drawn before the planets so the
            re-entry tail disappears behind Earth. */}
        <path
          d={geometry.d}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={strokeW}
          strokeOpacity={0.3}
          strokeDasharray={`${dash} ${gap}`}
        />

        {/* Travelled overlay — solid line, drawn via dynamic stroke-dasharray */}
        <path
          ref={travelledRef}
          d={geometry.d}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={strokeW}
          strokeOpacity={0.95}
          strokeDasharray={`0 ${geometry.total}`}
        />

        {/* Earth — on top of the paths so it covers the re-entry tail */}
        <g>
          <circle cx={0} cy={0} r={earthR * 1.18} fill="url(#tm-atm)" />
          <circle cx={0} cy={0} r={earthR} fill="url(#tm-earth)" />
          <g clipPath="url(#tm-earth-clip)">
            <g>
              <animateTransform
                attributeName="transform"
                type="rotate"
                from="0 0 0"
                to="360 0 0"
                dur="24s"
                repeatCount="indefinite"
              />
              {/* Very simplified continent blobs within the unit circle */}
              <path
                d="M -0.55 -0.35 Q -0.32 -0.55 -0.1 -0.42 Q 0.05 -0.2 -0.08 -0.02 Q -0.3 0.05 -0.5 -0.1 Q -0.62 -0.22 -0.55 -0.35 Z"
                fill="#1f6a3a"
                opacity="0.78"
              />
              <path
                d="M 0.1 -0.1 Q 0.35 -0.25 0.55 -0.05 Q 0.6 0.2 0.4 0.3 Q 0.18 0.28 0.08 0.12 Q 0.02 -0.02 0.1 -0.1 Z"
                fill="#1f6a3a"
                opacity="0.72"
              />
              <path
                d="M -0.25 0.35 Q -0.05 0.28 0.12 0.4 Q 0.1 0.6 -0.1 0.62 Q -0.28 0.55 -0.3 0.45 Q -0.3 0.38 -0.25 0.35 Z"
                fill="#1f6a3a"
                opacity="0.7"
              />
            </g>
          </g>
          {/* Faint meridian hint */}
          <ellipse
            cx={0}
            cy={0}
            rx={earthR * 0.35}
            ry={earthR}
            fill="none"
            stroke="rgba(95,168,255,0.18)"
            strokeWidth={strokeW * 0.4}
          />
          <ellipse
            cx={0}
            cy={0}
            rx={earthR}
            ry={earthR * 0.35}
            fill="none"
            stroke="rgba(95,168,255,0.18)"
            strokeWidth={strokeW * 0.4}
          />
          {/* Day/night terminator */}
          <circle cx={0} cy={0} r={earthR} fill="url(#tm-terminator)" />
        </g>

        {/* Moon */}
        <g>
          <circle cx={MOON_POSITION.x} cy={MOON_POSITION.z} r={moonR} fill="url(#tm-moon)" />
          <g clipPath="url(#tm-moon-clip)">
            <circle cx={MOON_POSITION.x - moonR * 0.35} cy={MOON_POSITION.z - moonR * 0.2} r={moonR * 0.18} fill="#2a2a30" opacity="0.55" />
            <circle cx={MOON_POSITION.x + moonR * 0.28} cy={MOON_POSITION.z + moonR * 0.32} r={moonR * 0.14} fill="#2a2a30" opacity="0.5" />
            <circle cx={MOON_POSITION.x - moonR * 0.1} cy={MOON_POSITION.z + moonR * 0.45} r={moonR * 0.11} fill="#2a2a30" opacity="0.5" />
            <circle cx={MOON_POSITION.x + moonR * 0.45} cy={MOON_POSITION.z - moonR * 0.1} r={moonR * 0.09} fill="#2a2a30" opacity="0.45" />
          </g>
        </g>

        {/* Spacecraft dot — drawn last so it stays visible on top of the
            planets (splashdown marker on the Earth disk). */}
        <circle ref={dotRingRef} cx={0} cy={0} r={strokeW * 3} fill="none" stroke="var(--accent)" strokeWidth={strokeW * 0.6}>
          <animate attributeName="r" values={`${strokeW * 2.5};${strokeW * 5};${strokeW * 2.5}`} dur="1.6s" repeatCount="indefinite" />
          <animate attributeName="stroke-opacity" values="0.8;0;0.8" dur="1.6s" repeatCount="indefinite" />
        </circle>
        <circle ref={dotRef} cx={0} cy={0} r={strokeW * 1.6} fill="var(--accent)">
          <animate attributeName="fill-opacity" values="1;0.4;1" dur="1.2s" repeatCount="indefinite" />
        </circle>
      </svg>
      <span className="phase-mini">Phase: {phaseLabel}</span>
    </aside>
  );
}
