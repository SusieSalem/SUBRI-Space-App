// 3D Launch Sequence Scene (Role 4 — feat/moon-launch-audio)
// Built from lightweight geometric primitives in React Three Fiber.
// Differentiates rocket classes: Small/Light (Electron), Medium (Falcon 9),
// Heavy (Falcon Heavy with side boosters), and Rideshare.

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  isMuted,
  playCountdownBeep,
  playLaunchRumbling,
  toggleMute,
} from "../audio/soundManager";

export type LaunchRocketType = "small" | "light" | "medium" | "heavy" | "rideshare";

export interface LaunchSceneProps {
  /** Selected rocket class from RocketScreen or App state. */
  rocketId?: LaunchRocketType;
  /** Optional mission or spacecraft name shown in the launch telemetry HUD. */
  missionName?: string;
  /** Duration of the launch sequence in seconds before onComplete fires. */
  durationSec?: number;
  /** Called when the launch sequence finishes or when the player clicks Skip. */
  onComplete?: () => void;
  /** Whether to show the telemetry overlay and Skip/Mute controls. */
  showHud?: boolean;
}

interface RocketSpecVisual {
  label: string;
  subtitle: string;
  coreRadius: number;
  coreHeight: number;
  fairingHeight: number;
  bodyColor: string;
  accentColor: string;
  fairingColor: string;
  boosterCount: 0 | 2;
  isRideshare: boolean;
  thrustScale: number;
}

const ROCKET_VISUALS: Record<LaunchRocketType, RocketSpecVisual> = {
  small: {
    label: "Small Launcher (Electron Class)",
    subtitle: "300 kg to LEO · Carbon-Composite Vehicle",
    coreRadius: 0.24,
    coreHeight: 3.1,
    fairingHeight: 0.95,
    bodyColor: "#1d222b",
    accentColor: "#38bdf8",
    fairingColor: "#e2e8f0",
    boosterCount: 0,
    isRideshare: false,
    thrustScale: 0.78,
  },
  light: {
    label: "Light Launcher (Electron Class)",
    subtitle: "Dedicated Small-Sat Vehicle",
    coreRadius: 0.24,
    coreHeight: 3.1,
    fairingHeight: 0.95,
    bodyColor: "#1d222b",
    accentColor: "#38bdf8",
    fairingColor: "#e2e8f0",
    boosterCount: 0,
    isRideshare: false,
    thrustScale: 0.78,
  },
  medium: {
    label: "Medium Launcher (Falcon 9 Class)",
    subtitle: "17,000 kg to LEO · Two-Stage Reusable",
    coreRadius: 0.36,
    coreHeight: 4.5,
    fairingHeight: 1.35,
    bodyColor: "#f1f5f9",
    accentColor: "#1e293b",
    fairingColor: "#f8fafc",
    boosterCount: 0,
    isRideshare: false,
    thrustScale: 1.05,
  },
  heavy: {
    label: "Heavy Launcher (Falcon Heavy Class)",
    subtitle: "60,000 kg to LEO · Triple-Core Heavy Lift",
    coreRadius: 0.38,
    coreHeight: 4.7,
    fairingHeight: 1.5,
    bodyColor: "#f8fafc",
    accentColor: "#dc2626",
    fairingColor: "#ffffff",
    boosterCount: 2,
    isRideshare: false,
    thrustScale: 1.45,
  },
  rideshare: {
    label: "Rideshare Dispenser (Transporter Class)",
    subtitle: "Multi-Payload SSO Stack · $6M / 100 kg",
    coreRadius: 0.36,
    coreHeight: 4.3,
    fairingHeight: 1.45,
    bodyColor: "#e2e8f0",
    accentColor: "#f59e0b",
    fairingColor: "#cbd5e1",
    boosterCount: 0,
    isRideshare: true,
    thrustScale: 1.0,
  },
};

interface exhaustPlumeProps {
  x?: number;
  scale?: number;
  intensityRef: React.MutableRefObject<number>;
}

function ExhaustPlume({ x = 0, scale = 1, intensityRef }: exhaustPlumeProps) {
  const outerRef = useRef<THREE.Mesh>(null);
  const innerRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const p = intensityRef.current;
    const flicker = 0.88 + 0.24 * Math.sin(clock.elapsedTime * 58 + x * 7);
    const s = Math.max(0.001, p * scale * flicker);

    if (outerRef.current) {
      outerRef.current.scale.set(scale * (0.85 + 0.15 * flicker), s, scale * (0.85 + 0.15 * flicker));
      outerRef.current.visible = p > 0.02;
    }
    if (innerRef.current) {
      innerRef.current.scale.set(scale * 0.65, s * 0.75, scale * 0.65);
      innerRef.current.visible = p > 0.02;
    }
  });

  return (
    <group position={[x, -0.1, 0]}>
      {/* Outer orange-amber flame cone */}
      <mesh ref={outerRef} position={[0, -0.95, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.32, 2.1, 16, 1, true]} />
        <meshBasicMaterial
          color="#ff6b1a"
          transparent
          opacity={0.78}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* Inner white-hot Mach diamond core */}
      <mesh ref={innerRef} position={[0, -0.6, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.18, 1.35, 12]} />
        <meshBasicMaterial
          color="#fff7d6"
          transparent
          opacity={0.95}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

interface RocketAssemblyProps {
  spec: RocketSpecVisual;
  plumeIntensityRef: React.MutableRefObject<number>;
}

function RocketModel({ spec, plumeIntensityRef }: RocketAssemblyProps) {
  const {
    coreRadius: r,
    coreHeight: h,
    fairingHeight: fh,
    bodyColor,
    accentColor,
    fairingColor,
    boosterCount,
    isRideshare,
    thrustScale,
  } = spec;

  const boosterOffset = r * 2.15;
  const boosterHeight = h * 0.78;
  const boosterRadius = r * 0.86;

  return (
    <group>
      {/* Main first stage cylinder */}
      <mesh position={[0, h * 0.38, 0]}>
        <cylinderGeometry args={[r, r, h * 0.76, 24]} />
        <meshStandardMaterial color={bodyColor} roughness={0.35} metalness={0.25} />
      </mesh>

      {/* Interstage band */}
      <mesh position={[0, h * 0.8, 0]}>
        <cylinderGeometry args={[r * 1.01, r * 1.01, h * 0.12, 24]} />
        <meshStandardMaterial color={accentColor} roughness={0.5} metalness={0.3} />
      </mesh>

      {/* Upper stage cylinder */}
      <mesh position={[0, h * 0.94, 0]}>
        <cylinderGeometry args={[r, r, h * 0.18, 24]} />
        <meshStandardMaterial color={bodyColor} roughness={0.35} metalness={0.25} />
      </mesh>

      {/* Payload Fairing */}
      <mesh position={[0, h * 1.03 + fh * 0.5, 0]}>
        <coneGeometry args={[r * 1.06, fh, 24]} />
        <meshStandardMaterial
          color={fairingColor}
          roughness={0.3}
          metalness={0.2}
          transparent={isRideshare}
          opacity={isRideshare ? 0.68 : 1}
        />
      </mesh>

      {/* Rideshare internal satellite stack highlight */}
      {isRideshare && (
        <group position={[0, h * 1.03 + fh * 0.32, 0]}>
          <mesh>
            <cylinderGeometry args={[r * 0.55, r * 0.55, fh * 0.48, 12]} />
            <meshStandardMaterial color="#f59e0b" metalness={0.6} roughness={0.25} />
          </mesh>
          <mesh position={[0, fh * 0.18, 0]}>
            <boxGeometry args={[r * 0.9, r * 0.35, r * 0.9]} />
            <meshStandardMaterial color="#38bdf8" emissive="#0284c7" emissiveIntensity={0.35} />
          </mesh>
        </group>
      )}

      {/* Engine nozzle bell (center core) */}
      <mesh position={[0, -0.08, 0]}>
        <cylinderGeometry args={[r * 0.55, r * 0.78, 0.24, 16]} />
        <meshStandardMaterial color="#334155" metalness={0.75} roughness={0.3} />
      </mesh>
      <ExhaustPlume x={0} scale={thrustScale} intensityRef={plumeIntensityRef} />

      {/* Side Boosters for Heavy class */}
      {boosterCount === 2 &&
        [-boosterOffset, boosterOffset].map((bx) => (
          <group key={bx} position={[bx, 0, 0]}>
            <mesh position={[0, boosterHeight * 0.5, 0]}>
              <cylinderGeometry args={[boosterRadius, boosterRadius, boosterHeight, 20]} />
              <meshStandardMaterial color={bodyColor} roughness={0.35} metalness={0.25} />
            </mesh>
            {/* Booster nose cone */}
            <mesh position={[0, boosterHeight + 0.32, 0]}>
              <coneGeometry args={[boosterRadius, 0.65, 20]} />
              <meshStandardMaterial color={accentColor} roughness={0.4} metalness={0.3} />
            </mesh>
            {/* Struts connecting booster to center core */}
            <mesh position={[bx > 0 ? -r * 0.9 : r * 0.9, boosterHeight * 0.82, 0]}>
              <boxGeometry args={[r * 0.6, 0.1, 0.14]} />
              <meshStandardMaterial color="#475569" metalness={0.6} />
            </mesh>
            <mesh position={[0, -0.07, 0]}>
              <cylinderGeometry args={[boosterRadius * 0.5, boosterRadius * 0.74, 0.22, 14]} />
              <meshStandardMaterial color="#334155" metalness={0.75} roughness={0.3} />
            </mesh>
            <ExhaustPlume x={0} scale={thrustScale * 0.82} intensityRef={plumeIntensityRef} />
          </group>
        ))}
    </group>
  );
}

interface SmokePuffData {
  dirX: number;
  dirZ: number;
  speed: number;
  baseScale: number;
  phaseOffset: number;
}

export interface LaunchSequenceGroupProps {
  rocketId?: LaunchRocketType;
  durationSec?: number;
  onPhaseChange?: (phaseText: string, altitudeKm: number, velocityKms: number) => void;
  onComplete?: () => void;
}

export function LaunchSequenceGroup({
  rocketId = "medium",
  durationSec = 4.4,
  onPhaseChange,
  onComplete,
}: LaunchSequenceGroupProps) {
  const spec = ROCKET_VISUALS[rocketId] ?? ROCKET_VISUALS.medium;
  const rocketGroupRef = useRef<THREE.Group>(null);
  const armRef = useRef<THREE.Mesh>(null);
  const smokeGroupRef = useRef<THREE.Group>(null);
  const engineLightRef = useRef<THREE.PointLight>(null);
  const plumeIntensityRef = useRef<number>(0);

  const elapsedRef = useRef<number>(0);
  const completedRef = useRef<boolean>(false);
  const lastPhaseSentRef = useRef<string>("");

  const puffs = useMemo<SmokePuffData[]>(() => {
    const arr: SmokePuffData[] = [];
    for (let i = 0; i < 22; i++) {
      const angle = (i / 22) * Math.PI * 2;
      arr.push({
        dirX: Math.cos(angle) * (0.7 + (i % 3) * 0.35),
        dirZ: Math.sin(angle) * (0.7 + (i % 2) * 0.35),
        speed: 1.4 + (i % 5) * 0.45,
        baseScale: 0.32 + (i % 4) * 0.14,
        phaseOffset: (i * 0.17) % 1,
      });
    }
    return arr;
  }, []);

  useFrame(({ camera }, dt) => {
    elapsedRef.current += Math.min(dt, 0.1);
    const t = elapsedRef.current;
    const progress = Math.min(1, t / durationSec);

    // Stage 1: Ignition buildup (0 .. 0.85s)
    // Stage 2: Liftoff & Tower Clear (0.85s .. 2.6s)
    // Stage 3: Pitch over & Ascent to Orbit (2.6s .. durationSec)
    const liftoffTime = 0.85;
    const flightTime = Math.max(0, t - liftoffTime);

    // Engine thrust ramps up during ignition
    plumeIntensityRef.current = t < liftoffTime ? Math.min(1, t / 0.45) : 1.0;

    // Retract umbilical arm right at liftoff
    if (armRef.current) {
      const retract = Math.min(1, Math.max(0, (t - 0.55) / 0.6));
      armRef.current.rotation.z = retract * 0.65;
    }

    // Rocket vertical & downrange motion
    const altitudeScene = 2.4 * flightTime * flightTime + 0.65 * flightTime;
    const pitchAngle = Math.min(0.42, Math.max(0, (flightTime - 0.8) * 0.14));

    if (rocketGroupRef.current) {
      rocketGroupRef.current.position.set(
        Math.sin(pitchAngle) * altitudeScene * 0.22,
        altitudeScene,
        0,
      );
      rocketGroupRef.current.rotation.z = -pitchAngle;
    }

    // Dynamic orange pad illumination
    if (engineLightRef.current) {
      const flicker = 0.9 + 0.2 * Math.sin(t * 45);
      engineLightRef.current.intensity = plumeIntensityRef.current * 8.5 * flicker;
      engineLightRef.current.position.set(0, Math.min(altitudeScene, 6) + 0.3, 1.2);
    }

    // Animate pad trench smoke billows
    if (smokeGroupRef.current) {
      smokeGroupRef.current.children.forEach((child, idx) => {
        const mesh = child as THREE.Mesh;
        const p = puffs[idx];
        const cycle = (t * 0.95 + p.phaseOffset) % 1;
        const activeFactor = t < 3.2 ? Math.min(1, t * 2.2) : Math.max(0, 1 - (t - 3.2) * 0.8);
        const radiusSpread = cycle * p.speed * 2.8;
        mesh.position.set(
          p.dirX * radiusSpread,
          0.15 + cycle * 1.15,
          p.dirZ * radiusSpread,
        );
        const scale = p.baseScale * (0.6 + cycle * 2.1) * activeFactor;
        mesh.scale.setScalar(Math.max(0.001, scale));
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.opacity = Math.max(0, (1 - cycle) * 0.55 * activeFactor);
      });
    }

    // Camera tracking with subtle vibration during ignition & liftoff
    const shakeMag =
      t < 2.4 ? (0.045 * plumeIntensityRef.current) / (1 + flightTime * 0.8) : 0.008;
    const shakeX = Math.sin(t * 67) * shakeMag;
    const shakeY = Math.cos(t * 83) * shakeMag;

    const camY = 2.4 + altitudeScene * 0.55;
    const camZ = 9.2 + Math.min(4.5, flightTime * 1.1);
    camera.position.set(1.8 + shakeX, camY + shakeY, camZ);
    camera.lookAt(
      rocketGroupRef.current ? rocketGroupRef.current.position.x : 0,
      altitudeScene + 2.1,
      0,
    );

    // Compute telemetry readout for HUD
    const altKm = Math.min(185, Math.round(flightTime * flightTime * 14.5 * 10) / 10);
    const velKms = Math.min(7.8, Math.round(flightTime * 2.15 * 100) / 100);
    const phaseLabel =
      t < liftoffTime
        ? "T-00:01 · MAIN ENGINE IGNITION"
        : t < 2.2
          ? "LIFTOFF · TOWER CLEAR"
          : t < 3.5
            ? "SUPERSONIC · MAX-Q PASSAGE"
            : "STAGE 1 ASCENT · ORBIT INSERTION";

    if (onPhaseChange && lastPhaseSentRef.current !== `${phaseLabel}-${altKm.toFixed(0)}`) {
      lastPhaseSentRef.current = `${phaseLabel}-${altKm.toFixed(0)}`;
      onPhaseChange(phaseLabel, altKm, velKms);
    }

    if (progress >= 1 && !completedRef.current) {
      completedRef.current = true;
      onComplete?.();
    }
  });

  return (
    <group>
      {/* Ambient & Directional Lighting */}
      <ambientLight intensity={0.45} />
      <directionalLight position={[12, 24, 14]} intensity={2.1} color="#f8fafc" />
      <pointLight ref={engineLightRef} color="#ff7b29" intensity={0} distance={22} decay={1.7} />

      {/* Ground Plane & Flame Trench Concrete Pad */}
      <mesh position={[0, -0.6, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[36, 48]} />
        <meshStandardMaterial color="#0f172a" roughness={0.95} />
      </mesh>

      {/* Launch Pad Concrete Pedestal */}
      <mesh position={[0, -0.25, 0]}>
        <boxGeometry args={[3.8, 0.5, 3.8]} />
        <meshStandardMaterial color="#334155" roughness={0.8} metalness={0.2} />
      </mesh>

      {/* Flame Deflector Trench */}
      <mesh position={[0, -0.05, 0]}>
        <boxGeometry args={[2.1, 0.2, 2.4]} />
        <meshStandardMaterial color="#1e293b" roughness={0.9} />
      </mesh>

      {/* Umbilical Launch Tower */}
      <group position={[-1.55, 0, -0.35]}>
        <mesh position={[0, 2.8, 0]}>
          <boxGeometry args={[0.55, 5.6, 0.55]} />
          <meshStandardMaterial color="#475569" metalness={0.5} roughness={0.5} wireframe={false} />
        </mesh>
        {/* Retracting Crew / Telemetry Umbilical Arm */}
        <mesh ref={armRef} position={[0.65, 4.1, 0.2]}>
          <boxGeometry args={[1.25, 0.16, 0.18]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.6} roughness={0.35} />
        </mesh>
        {/* Lightning Mast */}
        <mesh position={[0, 6.2, 0]}>
          <cylinderGeometry args={[0.03, 0.07, 1.4, 8]} />
          <meshStandardMaterial color="#cbd5e1" />
        </mesh>
      </group>

      {/* Volumetric-style Pad Smoke Puffs */}
      <group ref={smokeGroupRef}>
        {puffs.map((_, idx) => (
          <mesh key={idx} position={[0, 0.1, 0]}>
            <icosahedronGeometry args={[0.45, 1]} />
            <meshStandardMaterial
              color="#e2e8f0"
              transparent
              opacity={0.45}
              roughness={1}
              depthWrite={false}
            />
          </mesh>
        ))}
      </group>

      {/* Ascending Rocket Assembly */}
      <group ref={rocketGroupRef} position={[0, 0, 0]}>
        <RocketModel spec={spec} plumeIntensityRef={plumeIntensityRef} />
      </group>
    </group>
  );
}

export function LaunchScene({
  rocketId = "medium",
  missionName = "Wildfire Watch",
  durationSec = 4.4,
  onComplete,
  showHud = true,
}: LaunchSceneProps) {
  const spec = ROCKET_VISUALS[rocketId] ?? ROCKET_VISUALS.medium;
  const [phaseText, setPhaseText] = useState("T-00:01 · MAIN ENGINE IGNITION");
  const [altitudeKm, setAltitudeKm] = useState(0);
  const [velocityKms, setVelocityKms] = useState(0);
  const [muted, setMutedState] = useState(() => isMuted());
  const finishedRef = useRef(false);

  useEffect(() => {
    playCountdownBeep(true);
    const stopRumble = playLaunchRumbling(durationSec);
    return () => {
      stopRumble();
    };
  }, [durationSec]);

  const handleComplete = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onComplete?.();
  };

  const handleToggleMute = () => {
    setMutedState(toggleMute());
  };

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: "420px",
        background: "radial-gradient(circle at 50% 85%, #1e293b 0%, #090d16 70%, #030712 100%)",
        overflow: "hidden",
      }}
    >
      <Canvas camera={{ position: [1.8, 2.4, 9.2], fov: 45 }}>
        <LaunchSequenceGroup
          rocketId={rocketId}
          durationSec={durationSec}
          onPhaseChange={(phase, alt, vel) => {
            setPhaseText(phase);
            setAltitudeKm(alt);
            setVelocityKms(vel);
          }}
          onComplete={handleComplete}
        />
      </Canvas>

      {showHud && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "20px 24px",
            fontFamily: "system-ui, -apple-system, sans-serif",
            color: "#f8fafc",
          }}
        >
          {/* Top bar */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div
              style={{
                background: "rgba(15, 23, 42, 0.78)",
                backdropFilter: "blur(8px)",
                border: "1px solid rgba(148, 163, 184, 0.25)",
                borderRadius: "10px",
                padding: "12px 16px",
              }}
            >
              <div style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.08em", color: "#38bdf8" }}>
                Launch Sequence · {missionName}
              </div>
              <div style={{ fontSize: "16px", fontWeight: 700, marginTop: "2px" }}>{spec.label}</div>
              <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "2px" }}>{spec.subtitle}</div>
            </div>

            <div style={{ display: "flex", gap: "10px", pointerEvents: "auto" }}>
              <button
                type="button"
                onClick={handleToggleMute}
                style={{
                  background: "rgba(15, 23, 42, 0.8)",
                  color: "#e2e8f0",
                  border: "1px solid rgba(148, 163, 184, 0.35)",
                  borderRadius: "8px",
                  padding: "8px 12px",
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                {muted ? "🔇 Audio Muted" : "🔊 Audio On"}
              </button>
              {onComplete && (
                <button
                  type="button"
                  onClick={handleComplete}
                  style={{
                    background: "#0284c7",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "8px",
                    padding: "8px 14px",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Skip to Orbit →
                </button>
              )}
            </div>
          </div>

          {/* Bottom Telemetry Bar */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              background: "rgba(15, 23, 42, 0.82)",
              backdropFilter: "blur(8px)",
              border: "1px solid rgba(148, 163, 184, 0.25)",
              borderRadius: "10px",
              padding: "12px 18px",
            }}
          >
            <div>
              <div style={{ fontSize: "11px", color: "#94a3b8", textTransform: "uppercase" }}>Flight Status</div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#fbbf24", fontFamily: "monospace" }}>
                {phaseText}
              </div>
            </div>
            <div style={{ display: "flex", gap: "28px", fontFamily: "monospace" }}>
              <div>
                <div style={{ fontSize: "11px", color: "#94a3b8" }}>ALTITUDE</div>
                <div style={{ fontSize: "16px", fontWeight: 700 }}>{altitudeKm.toFixed(1)} km</div>
              </div>
              <div>
                <div style={{ fontSize: "11px", color: "#94a3b8" }}>VELOCITY</div>
                <div style={{ fontSize: "16px", fontWeight: 700 }}>{velocityKms.toFixed(2)} km/s</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default LaunchScene;
