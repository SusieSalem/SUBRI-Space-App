import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import aiIcon from "../ui/AI assets/AI Icon.png";
import aiFront1 from "../ui/AI assets/AI front1.png";
import aiFront2 from "../ui/AI assets/AI front2.png";
import aiMoving1 from "../ui/AI assets/AI moving1.png";
import aiMoving2 from "../ui/AI assets/AI moving2.png";
import aiSpaceIcon from "../ui/AI assets/AI Space Icon.png";
import aiSpaceFront1 from "../ui/AI assets/AI Space front1.png";
import aiSpaceFront2 from "../ui/AI assets/AI Space front2.png";
import aiSpaceMoving1 from "../ui/AI assets/AI Space moving1.png";
import aiSpaceMoving2 from "../ui/AI assets/AI Space moving2.png";
import aiSpaceMoving3 from "../ui/AI assets/AI Space moving3.png";

export type AiAnimState = "front" | "moving";
export type AiPersona = "earth" | "space";

interface TutorialStep {
  id: string;
  tag?: string;
  title: string;
  text: string;
  targetSelector: string | null;
  placement: "center" | "right" | "left" | "top";
}

const EARTH_STEPS: TutorialStep[] = [
  {
    id: "welcome",
    title: "Welcome to Mission Architect",
    text: "I'm your Earth launch assistant. Before liftoff, let's take a quick look at the controls that shape your rocket's performance and launch conditions.",
    targetSelector: null,
    placement: "center",
  },
  {
    id: "parts",
    title: "Spacecraft Parts",
    text: "Choose your Crew Module, Heat Shield, and Avionics. Each part changes total mass, crew capacity, and how well your ship survives reentry and orbital flight.",
    targetSelector: ".panel.left",
    placement: "right",
  },
  {
    id: "rocket",
    title: "Launch Vehicle",
    text: "Pick a rocket booster. Heavy rockets lift more payload mass into orbit, while lighter rockets cost less thrust margin if your spacecraft stays light.",
    targetSelector: ".rockets",
    placement: "right",
  },
  {
    id: "readiness",
    title: "Readiness Gauges",
    text: "These bars check your mass budget, delta-v, crew, and safety systems. Every item must turn green before flight clearance is granted.",
    targetSelector: ".panel.right.assembly",
    placement: "left",
  },
  {
    id: "environment",
    title: "Weather, Date & Time",
    text: "Set launch date, time of day, and weather (Clear, Cloudy, Rain, or Storm). They change sky lighting, cloud cover, and storm lightning around the pad.",
    targetSelector: ".env-controls",
    placement: "top",
  },
  {
    id: "launch",
    title: "Ready for Liftoff",
    text: "Once all readiness checks are green, hit Launch to enter the 10-second countdown and fly your mission!",
    targetSelector: ".controls .primary.big",
    placement: "top",
  },
];

const SPACE_FACTS: TutorialStep[] = [
  {
    id: "karman",
    tag: "Fun Fact",
    title: "The Karman Line (100 km)",
    text: "Space officially begins 100 km above Earth. Above this altitude, the air is too thin for aircraft wings to generate lift, so only rockets and orbital speed keep you up.",
    targetSelector: null,
    placement: "left",
  },
  {
    id: "orbital-speed",
    tag: "Fun Fact",
    title: "Falling Around Earth",
    text: "Low Earth Orbit requires ~7.8 km/s (28,000 km/h). Astronauts don't float because gravity is gone — they're in continuous free fall, moving sideways fast enough to miss Earth!",
    targetSelector: null,
    placement: "left",
  },
  {
    id: "east-launch",
    tag: "Orbital Tip",
    title: "Why Rockets Pitch East",
    text: "Earth spins eastward at up to 465 m/s at the equator. Pitching east during your gravity turn gives your rocket a free speed boost into orbit.",
    targetSelector: null,
    placement: "left",
  },
  {
    id: "moon-distance",
    tag: "Fun Fact",
    title: "384,400 km to the Moon",
    text: "All the other planets in our solar system could actually fit side by side between Earth and the Moon! Apollo spacecraft took about 3 days to cross that gap.",
    targetSelector: null,
    placement: "left",
  },
  {
    id: "reentry",
    tag: "Fun Fact",
    title: "Reentry Plasma Shield",
    text: "Returning from orbit compresses air ahead of your spacecraft to over 1,600°C, turning it into glowing plasma. Your Heat Shield absorbs and sheds that energy.",
    targetSelector: null,
    placement: "left",
  },
  {
    id: "flight-controls",
    tag: "Flight Tip",
    title: "Quick Flight Controls",
    text: "Press M to toggle Map View, T for Autopilot, WASD to steer manually, and use the warp buttons (or , and .) to speed up long orbital coasts.",
    targetSelector: null,
    placement: "left",
  },
];

interface PersonaSprites {
  icon: string;
  front: string[];
  moving: string[];
  label: string;
}

const PERSONA_SPRITES: Record<AiPersona, PersonaSprites> = {
  earth: {
    icon: aiIcon,
    front: [aiFront1, aiFront2],
    moving: [aiMoving1, aiMoving2],
    label: "Guide",
  },
  space: {
    icon: aiSpaceIcon,
    front: [aiSpaceFront1, aiSpaceFront2],
    moving: [aiSpaceMoving1, aiSpaceMoving2, aiSpaceMoving3],
    label: "Space AI",
  },
};

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const SPOTLIGHT_PAD = 8;
const MOVE_DURATION_MS = 520;

interface StagePosition {
  x: number;
  y: number;
  bubbleSide: "left" | "right";
}

function getAfkCoords(_persona: AiPersona, vw: number): { x: number; y: number } {
  return { x: vw / 2 - 44, y: 66 };
}

function computeStagePosition(
  persona: AiPersona,
  stepIndex: number,
  rect: SpotlightRect | null,
  placement: TutorialStep["placement"],
  vw: number,
  vh: number,
): StagePosition {
  const spriteW = Math.min(300, Math.max(220, vw * 0.22));
  const bubbleW = Math.min(330, Math.max(230, vw - spriteW - 48));
  const stageW = spriteW + 12 + bubbleW;
  const stageH = Math.min(350, Math.max(260, vh * 0.38));

  const clampX = (x: number) => Math.max(12, Math.min(vw - stageW - 12, x));
  const clampY = (y: number) => Math.max(66, Math.min(vh - stageH - 16, y));

  if (persona === "space") {
    const spaceAnchors: StagePosition[] = [
      { x: clampX(20), y: clampY(76), bubbleSide: "right" },
      { x: clampX(vw * 0.26), y: clampY(108), bubbleSide: "right" },
      { x: clampX(24), y: clampY(vh - stageH - 110), bubbleSide: "right" },
      { x: clampX(vw - stageW - 330), y: clampY(vh - stageH - 110), bubbleSide: "left" },
    ];
    return spaceAnchors[stepIndex % spaceAnchors.length];
  }

  if (!rect || placement === "center") {
    return {
      x: clampX((vw - stageW) / 2),
      y: clampY((vh - stageH) / 2),
      bubbleSide: "right",
    };
  }

  if (placement === "right") {
    const candidateX = rect.left + rect.width + 16;
    if (candidateX + stageW <= vw - 12) {
      return {
        x: candidateX,
        y: clampY(rect.top + Math.min(rect.height * 0.25, 140)),
        bubbleSide: "right",
      };
    }
    return {
      x: clampX((vw - stageW) / 2),
      y: clampY(vh - stageH - 96),
      bubbleSide: "right",
    };
  }

  if (placement === "left") {
    const candidateX = rect.left - stageW - 16;
    if (candidateX >= 12) {
      return {
        x: candidateX,
        y: clampY(rect.top + Math.min(rect.height * 0.25, 140)),
        bubbleSide: "left",
      };
    }
    return {
      x: clampX((vw - stageW) / 2),
      y: clampY(vh - stageH - 96),
      bubbleSide: "left",
    };
  }

  const targetCenterX = rect.left + rect.width / 2;
  return {
    x: clampX(targetCenterX - stageW / 2),
    y: clampY(rect.top - stageH - 14),
    bubbleSide: targetCenterX > vw * 0.62 ? "left" : "right",
  };
}

function getLiveFlightContext(phase?: string, altitudeM?: number): string | null {
  if (!phase) return null;
  if (phase.toLowerCase().includes("countdown")) {
    return "Hold tight — engines ignite at T-0! Stay on the pad until liftoff.";
  }
  if (altitudeM !== undefined && altitudeM > 100_000 && altitudeM < 300_000) {
    return "You just crossed the 100 km Karman line — welcome to outer space!";
  }
  if (phase.toLowerCase().includes("moon")) {
    return "Near the Moon! Watch your periapsis and throttle carefully.";
  }
  return null;
}

interface TutorialOverlayProps {
  persona: AiPersona;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flightPhase?: string;
  altitudeM?: number;
}

export function TutorialOverlay({
  persona,
  open,
  onOpenChange,
  flightPhase,
  altitudeM,
}: TutorialOverlayProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [frameIndex, setFrameIndex] = useState(0);
  const [rect, setRect] = useState<SpotlightRect | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  const [facingRight, setFacingRight] = useState(false);
  const [closingToAfk, setClosingToAfk] = useState(false);

  const prevStageXRef = useRef<number | null>(null);
  const moveTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const steps = persona === "space" ? SPACE_FACTS : EARTH_STEPS;
  const step = steps[stepIndex] ?? steps[0];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;
  const sprites = PERSONA_SPRITES[persona];

  // Reset step index and transient animation flags when switching between Earth and Space AI
  useEffect(() => {
    setStepIndex(0);
    setFrameIndex(0);
    setIsMoving(false);
    setClosingToAfk(false);
    prevStageXRef.current = null;
    if (moveTimerRef.current !== null) {
      window.clearTimeout(moveTimerRef.current);
      moveTimerRef.current = null;
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, [persona]);

  // Animate sprite frames (faster cadence while moving, calm idle when stopped)
  useEffect(() => {
    if (!open && !closingToAfk) return;
    const activeFrames = isMoving || closingToAfk ? sprites.moving : sprites.front;
    const intervalMs = isMoving || closingToAfk ? 160 : 480;
    const id = window.setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % activeFrames.length);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [open, closingToAfk, isMoving, sprites]);

  const measureTarget = useCallback(
    (scrollIntoView: boolean) => {
      if (!open || closingToAfk || persona === "space" || !step.targetSelector) {
        setRect(null);
        return;
      }
      const el = document.querySelector(step.targetSelector);
      if (!el) {
        setRect(null);
        return;
      }

      const scrollPanel = el.closest(".panel");
      if (scrollIntoView && scrollPanel && scrollPanel !== el) {
        el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
      }

      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) {
        setRect(null);
        return;
      }

      let left = r.left;
      let top = r.top;
      let right = r.right;
      let bottom = r.bottom;

      if (scrollPanel && scrollPanel !== el) {
        const pr = scrollPanel.getBoundingClientRect();
        left = Math.max(left, pr.left);
        top = Math.max(top, pr.top);
        right = Math.min(right, pr.right);
        bottom = Math.min(bottom, pr.bottom);
      }

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const paddedTop = Math.max(0, top - SPOTLIGHT_PAD);
      const paddedLeft = Math.max(0, left - SPOTLIGHT_PAD);
      const paddedRight = Math.min(vw, right + SPOTLIGHT_PAD);
      const paddedBottom = Math.min(vh, bottom + SPOTLIGHT_PAD);

      setRect({
        top: paddedTop,
        left: paddedLeft,
        width: Math.max(0, paddedRight - paddedLeft),
        height: Math.max(0, paddedBottom - paddedTop),
      });
    },
    [open, closingToAfk, persona, step.targetSelector],
  );

  useLayoutEffect(() => {
    measureTarget(true);
  }, [measureTarget]);

  useEffect(() => {
    if (!open || closingToAfk || persona === "space") return;
    const onResizeOrScroll = () => measureTarget(false);
    window.addEventListener("resize", onResizeOrScroll);
    window.addEventListener("scroll", onResizeOrScroll, true);
    return () => {
      window.removeEventListener("resize", onResizeOrScroll);
      window.removeEventListener("scroll", onResizeOrScroll, true);
    };
  }, [open, closingToAfk, persona, measureTarget]);

  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 720;
  const stagePos = computeStagePosition(persona, stepIndex, rect, step.placement, vw, vh);
  const afkCoords = getAfkCoords(persona, vw);

  // Trigger moving sprite whenever the AI glides to a new screen position
  useEffect(() => {
    if (!open || closingToAfk) {
      prevStageXRef.current = null;
      setIsMoving(false);
      return;
    }

    const prevX = prevStageXRef.current;
    prevStageXRef.current = stagePos.x;

    if (prevX !== null && Math.abs(stagePos.x - prevX) > 12) {
      setFacingRight(stagePos.x > prevX);
      setIsMoving(true);
      if (moveTimerRef.current !== null) {
        window.clearTimeout(moveTimerRef.current);
      }
      moveTimerRef.current = window.setTimeout(() => {
        setIsMoving(false);
        moveTimerRef.current = null;
      }, MOVE_DURATION_MS);
    }
  }, [open, closingToAfk, stepIndex, stagePos.x]);

  useEffect(() => {
    return () => {
      if (moveTimerRef.current !== null) window.clearTimeout(moveTimerRef.current);
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  const handleClose = useCallback(() => {
    if (closingToAfk || !open) return;
    setFacingRight(afkCoords.x > stagePos.x);
    setClosingToAfk(true);
    closeTimerRef.current = window.setTimeout(() => {
      setClosingToAfk(false);
      closeTimerRef.current = null;
      onOpenChange(false);
    }, MOVE_DURATION_MS);
  }, [closingToAfk, open, afkCoords.x, stagePos.x, onOpenChange]);

  useEffect(() => {
    if (!open || closingToAfk) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      } else if (e.key === "ArrowRight") {
        if (isLast && persona === "earth") {
          handleClose();
        } else {
          setStepIndex((i) => (i + 1) % steps.length);
        }
      } else if (e.key === "ArrowLeft" && !isFirst) {
        setStepIndex((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, closingToAfk, isFirst, isLast, persona, steps.length, handleClose]);

  const handleOpen = () => {
    if (persona === "earth") {
      setStepIndex(0);
    }
    onOpenChange(true);
  };

  const handleNext = () => {
    if (isLast && persona === "earth") {
      handleClose();
    } else if (persona === "space") {
      setStepIndex((i) => (i + 1) % steps.length);
    } else {
      setStepIndex((i) => Math.min(steps.length - 1, i + 1));
    }
  };

  const handleBack = () => {
    setStepIndex((i) => Math.max(0, i - 1));
  };

  if (!open && !closingToAfk) {
    return (
      <button
        type="button"
        className={`tutorial-afk-btn ${persona === "space" ? "afk-space" : "afk-earth"}`}
        onClick={handleOpen}
        title={persona === "space" ? "Open Space AI Facts & Tips" : "Open Mission Guide"}
        aria-label={persona === "space" ? "Open Space AI Facts & Tips" : "Open Mission Guide"}
      >
        <img src={sprites.icon} alt={sprites.label} className="tutorial-afk-icon" />
        <span className="tutorial-afk-label">{sprites.label}</span>
      </button>
    );
  }

  const activeFrames = isMoving || closingToAfk ? sprites.moving : sprites.front;
  const spriteSrc = activeFrames[frameIndex % activeFrames.length];
  const spriteFlip = (isMoving || closingToAfk) && facingRight ? "scaleX(-1)" : "scaleX(1)";
  const liveNote = persona === "space" ? getLiveFlightContext(flightPhase, altitudeM) : null;

  const targetX = closingToAfk ? afkCoords.x : stagePos.x;
  const targetY = closingToAfk ? afkCoords.y : stagePos.y;

  return (
    <div
      className={`tutorial-root ${persona === "space" ? "mode-space-ai" : ""}`}
      role="dialog"
      aria-modal={persona === "earth"}
      aria-label={persona === "space" ? "Space AI Assistant" : "Mission Tutorial"}
    >
      {persona === "earth" && !closingToAfk && (
        rect ? (
          <>
            <div
              className="tutorial-backdrop"
              style={{ top: 0, left: 0, right: 0, height: `${rect.top}px` }}
              onClick={handleClose}
            />
            <div
              className="tutorial-backdrop"
              style={{
                top: `${rect.top}px`,
                left: 0,
                width: `${rect.left}px`,
                height: `${rect.height}px`,
              }}
              onClick={handleClose}
            />
            <div
              className="tutorial-backdrop"
              style={{
                top: `${rect.top}px`,
                left: `${rect.left + rect.width}px`,
                right: 0,
                height: `${rect.height}px`,
              }}
              onClick={handleClose}
            />
            <div
              className="tutorial-backdrop"
              style={{
                top: `${rect.top + rect.height}px`,
                left: 0,
                right: 0,
                bottom: 0,
              }}
              onClick={handleClose}
            />
            <div
              className="tutorial-spotlight-ring"
              style={{
                top: `${rect.top}px`,
                left: `${rect.left}px`,
                width: `${rect.width}px`,
                height: `${rect.height}px`,
              }}
            />
          </>
        ) : (
          <div className="tutorial-backdrop" style={{ inset: 0 }} onClick={handleClose} />
        )
      )}

      <div
        className={`tutorial-stage ${stagePos.bubbleSide === "left" ? "bubble-left" : "bubble-right"} ${
          closingToAfk ? "closing-to-afk" : ""
        }`}
        style={{ left: `${targetX}px`, top: `${targetY}px` }}
      >
        <img
          src={spriteSrc}
          alt={sprites.label}
          className="tutorial-sprite"
          style={{ transform: spriteFlip }}
        />

        <div className={`tutorial-bubble ${closingToAfk ? "bubble-hidden" : ""}`}>
          {liveNote && <div className="tutorial-live-note">{liveNote}</div>}
          <div className="tutorial-header">
            <span className="tutorial-step-pill">
              {step.tag ?? `${stepIndex + 1} / ${steps.length}`}
            </span>
            <h3 className="tutorial-title">{step.title}</h3>
          </div>
          <p className="tutorial-text">{step.text}</p>
          <div className="tutorial-actions">
            <button type="button" className="tutorial-btn ghost" onClick={handleClose}>
              {persona === "space" ? "Hide" : "Skip"}
            </button>
            <div className="tutorial-nav">
              {!isFirst && (
                <button type="button" className="tutorial-btn" onClick={handleBack}>
                  Back
                </button>
              )}
              <button type="button" className="tutorial-btn primary" onClick={handleNext}>
                {persona === "space" ? "Next Fact" : isLast ? "Finish" : "Next"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
