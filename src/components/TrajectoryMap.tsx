// Top-down radar-style minimap of the mission trajectory.
// Reuses the same path points and clock as the 3D scene.

import { useEffect, useMemo, useRef } from "react";
import type { MissionClock } from "../scenes/SpaceScene";
import {
  EARTH_RADIUS,
  MOON_POSITION,
  MOON_RADIUS,
  missionStateAt,
  newMissionState,
  plannedPathPoints,
} from "../scenes/mission";

interface Props {
  clock: React.MutableRefObject<MissionClock>;
}

const MARGIN = 0.08;

export default function TrajectoryMap({ clock }: Props) {
  // The planned path is static — compute geometry once.
  const geometry = useMemo(() => {
    const raw = plannedPathPoints();
    const pts = raw.map((p) => ({ x: p.x, z: p.z }));

    let minX = -EARTH_RADIUS;
    let maxX = EARTH_RADIUS;
    let minZ = -EARTH_RADIUS;
    let maxZ = EARTH_RADIUS;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    minX = Math.min(minX, MOON_POSITION.x - MOON_RADIUS);
    maxX = Math.max(maxX, MOON_POSITION.x + MOON_RADIUS);
    minZ = Math.min(minZ, MOON_POSITION.z - MOON_RADIUS);
    maxZ = Math.max(maxZ, MOON_POSITION.z + MOON_RADIUS);

    const padX = (maxX - minX) * MARGIN;
    const padZ = (maxZ - minZ) * MARGIN;
    const vbW = maxX - minX + 2 * padX;
    const vbH = maxZ - minZ + 2 * padZ;
    const viewBox = `${minX - padX} ${minZ - padZ} ${vbW} ${vbH}`;

    // Cumulative arc length — used to paint the travelled portion with a
    // dynamic stroke-dasharray.
    const cum: number[] = new Array(pts.length);
    cum[0] = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x;
      const dz = pts[i].z - pts[i - 1].z;
      cum[i] = cum[i - 1] + Math.hypot(dx, dz);
    }
    const total = cum[cum.length - 1];

    const d =
      "M " + pts.map((p) => `${p.x.toFixed(4)} ${p.z.toFixed(4)}`).join(" L ");

    return { viewBox, pts, cum, total, d, vbW };
  }, []);

  const travelledRef = useRef<SVGPathElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);
  const dotRingRef = useRef<SVGCircleElement>(null);
  const scratch = useMemo(() => newMissionState(), []);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = clock.current.time;
      missionStateAt(t, scratch);
      const px = scratch.position.x;
      const pz = scratch.position.z;

      if (dotRef.current) {
        dotRef.current.setAttribute("cx", px.toFixed(4));
        dotRef.current.setAttribute("cy", pz.toFixed(4));
      }
      if (dotRingRef.current) {
        dotRingRef.current.setAttribute("cx", px.toFixed(4));
        dotRingRef.current.setAttribute("cy", pz.toFixed(4));
      }

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

  const strokeW = Math.max(geometry.vbW, 1) * 0.004;
  const dash = strokeW * 2.5;
  const gap = strokeW * 2;

  return (
    <aside className="map-card">
      <div className="map-header">
        <span className="label">Trajectory</span>
      </div>
      <svg viewBox={geometry.viewBox} preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="tm-earth" cx="35%" cy="32%" r="68%">
            <stop offset="0%" stopColor="#3a7dc2" />
            <stop offset="70%" stopColor="#0e2a4a" />
            <stop offset="100%" stopColor="#02081a" />
          </radialGradient>
          <radialGradient id="tm-moon" cx="32%" cy="30%" r="72%">
            <stop offset="0%" stopColor="#d4d4dc" />
            <stop offset="70%" stopColor="#50505a" />
            <stop offset="100%" stopColor="#1a1a22" />
          </radialGradient>
        </defs>

        <circle cx={0} cy={0} r={EARTH_RADIUS} fill="url(#tm-earth)" />
        <circle
          cx={MOON_POSITION.x}
          cy={MOON_POSITION.z}
          r={MOON_RADIUS}
          fill="url(#tm-moon)"
        />

        <path
          d={geometry.d}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={strokeW}
          strokeOpacity={0.3}
          strokeDasharray={`${dash} ${gap}`}
        />
        <path
          ref={travelledRef}
          d={geometry.d}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={strokeW}
          strokeOpacity={0.95}
          strokeDasharray={`0 ${geometry.total}`}
        />

        <circle
          ref={dotRingRef}
          cx={0}
          cy={0}
          r={strokeW * 3}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={strokeW * 0.6}
        >
          <animate
            attributeName="r"
            values={`${strokeW * 2.5};${strokeW * 5};${strokeW * 2.5}`}
            dur="1.6s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="stroke-opacity"
            values="0.8;0;0.8"
            dur="1.6s"
            repeatCount="indefinite"
          />
        </circle>
        <circle ref={dotRef} cx={0} cy={0} r={strokeW * 1.6} fill="var(--accent)">
          <animate
            attributeName="fill-opacity"
            values="1;0.4;1"
            dur="1.2s"
            repeatCount="indefinite"
          />
        </circle>
      </svg>
    </aside>
  );
}
