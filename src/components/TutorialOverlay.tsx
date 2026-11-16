import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { playAiVoice, stopAiVoice } from "../audio/soundManager";
import type { Telemetry, WeatherState } from "../scenes/FlightScene";
import aiIcon from "../ui/AI assets/AI Icon.png";
import aiFront1 from "../ui/AI assets/AI front1.png";
import aiFront2 from "../ui/AI assets/AI front2.png";
import aiHappy1 from "../ui/AI assets/AI Happy1.png";
import aiHappy2 from "../ui/AI assets/AI Happy2.png";
import aiMoving1 from "../ui/AI assets/AI moving1.png";
import aiMoving2 from "../ui/AI assets/AI moving2.png";
import aiSad1 from "../ui/AI assets/AI Sad1.png";
import aiSad2 from "../ui/AI assets/AI Sad2.png";
import aiSpaceIcon from "../ui/AI assets/AI Space Icon.png";
import aiSpaceFront1 from "../ui/AI assets/AI Space front1.png";
import aiSpaceFront2 from "../ui/AI assets/AI Space front2.png";
import aiSpaceHappy1 from "../ui/AI assets/AI Space Happy1.png";
import aiSpaceHappy2 from "../ui/AI assets/AI Space Happy2.png";
import aiSpaceMoving1 from "../ui/AI assets/AI Space moving1.png";
import aiSpaceMoving2 from "../ui/AI assets/AI Space moving2.png";
import aiSpaceMoving3 from "../ui/AI assets/AI Space moving3.png";
import aiSpaceSad1 from "../ui/AI assets/AI Space Sad1.png";
import aiSpaceSad2 from "../ui/AI assets/AI Space Sad2.png";

export type AiAnimState = "front" | "moving" | "happy" | "sad";
export type AiPersona = "earth" | "planning" | "space";
type SpaceTab = "status" | "facts" | "trivia";
type EarthMode = "tutorial" | "menu" | "check" | "weather" | "trivia";

interface TutorialStep {
  id: string;
  tag?: string;
  title: string;
  text: string;
  targetSelector: string | null;
  placement: "center" | "right" | "left" | "top";
  emotion?: "front" | "happy";
  voiceClip?: string;
}

const EARTH_STEPS: TutorialStep[] = [
  {
    id: "welcome",
    title: "Welcome to Mission Architect",
    text: "I'm your Earth launch assistant. Before liftoff, let's take a quick look at the controls that shape your rocket's performance and launch conditions.",
    targetSelector: null,
    placement: "center",
    emotion: "happy",
    voiceClip: "/audio/voice/earth_ai/earth_welcome.mp3",
  },
  {
    id: "parts",
    title: "Spacecraft Parts",
    text: "Choose your Crew Module, Heat Shield, and Avionics. Each part changes total mass, crew capacity, and how well your ship survives reentry and orbital flight.",
    targetSelector: ".panel.left",
    placement: "right",
    voiceClip: "/audio/voice/earth_ai/earth_parts.mp3",
  },
  {
    id: "rocket",
    title: "Launch Vehicle",
    text: "Pick a rocket booster. Heavy rockets lift more payload mass into orbit, while lighter rockets cost less thrust margin if your spacecraft stays light.",
    targetSelector: ".rockets",
    placement: "right",
    voiceClip: "/audio/voice/earth_ai/earth_rocket.mp3",
  },
  {
    id: "readiness",
    title: "Readiness Gauges",
    text: "These bars check your mass budget, delta-v, crew, and safety systems. Every item must turn green before flight clearance is granted.",
    targetSelector: ".panel.right.assembly",
    placement: "left",
    voiceClip: "/audio/voice/earth_ai/earth_readiness.mp3",
  },
  {
    id: "environment",
    title: "Weather, Time & Settings",
    text: "Open the gear menu to set launch weather (Clear, Cloudy, Rain, or Storm), date, time of day, audio, and graphics quality.",
    targetSelector: ".controls .popover-anchor",
    placement: "top",
    voiceClip: "/audio/voice/earth_ai/earth_settings.mp3",
  },
  {
    id: "launch",
    title: "Ready for Liftoff",
    text: "Once all readiness checks are green, hit Plan the orbit or Launch with autopilot plan to begin your mission!",
    targetSelector: ".controls .primary.big",
    placement: "top",
    emotion: "happy",
    voiceClip: "/audio/voice/earth_ai/earth_ready_step.mp3",
  },
];

const PLANNING_STEPS: TutorialStep[] = [
  {
    id: "plan-welcome",
    title: "Step 2: Orbit Planner",
    text: "Welcome to Mission Control! Here you aim your Trans-Lunar Injection (TLI) burn so your crew flies around the Moon and returns safely home.",
    targetSelector: null,
    placement: "center",
    emotion: "happy",
    voiceClip: "/audio/voice/earth_ai/plan_welcome.mp3",
  },
  {
    id: "plan-maneuver",
    title: "Maneuver Controls",
    text: "Tune your Parking Altitude, Burn Point angle, and Burn Δv — or click 'Suggest a plan' to auto-compute a free-return trajectory.",
    targetSelector: ".planner-controls",
    placement: "right",
  },
  {
    id: "plan-map",
    title: "Live Trajectory & Moon Map",
    text: "See where your path meets the Moon (switch between Moon moves & Moon fixed), and drag the orange burn node on the close-up circle!",
    targetSelector: ".planner-map",
    placement: "left",
  },
  {
    id: "plan-checks",
    title: "Flight & Life-Support Checks",
    text: "Make sure all three checks (Reaches the Moon, Enough Propellant, and Comes Home within life-support days) turn green.",
    targetSelector: ".planner-checks",
    placement: "left",
  },
  {
    id: "plan-launch",
    title: "Launch This Plan",
    text: "When your free return looks good, click 'Launch this plan' to head to the pad and fly it!",
    targetSelector: ".controls .primary.big",
    placement: "top",
    emotion: "happy",
    voiceClip: "/audio/voice/earth_ai/plan_launch.mp3",
  },
];

type FlightZone = "atmosphere" | "orbit" | "moon" | "reentry";

interface SpaceFact {
  id: string;
  zone: FlightZone;
  tag: string;
  title: string;
  text: string;
}

const SPACE_FACTS: SpaceFact[] = [
  {
    id: "east-launch",
    zone: "atmosphere",
    tag: "Ascent Fact",
    title: "Why Rockets Pitch East",
    text: "Earth spins eastward at up to 465 m/s at the equator. Pitching east during your gravity turn gives your rocket a free speed boost into orbit.",
  },
  {
    id: "karman",
    zone: "atmosphere",
    tag: "Space Fact",
    title: "The Karman Line (100 km)",
    text: "Space officially begins 100 km above Earth. Above this altitude, air is too thin for wings to generate lift, so only orbital speed keeps you up.",
  },
  {
    id: "orbital-speed",
    zone: "orbit",
    tag: "Orbit Fact",
    title: "Falling Around Earth",
    text: "Low Earth Orbit requires ~7.8 km/s (28,000 km/h). Astronauts don't float because gravity is gone — they're in continuous free fall around Earth!",
  },
  {
    id: "moon-distance",
    zone: "moon",
    tag: "Lunar Fact",
    title: "384,400 km to the Moon",
    text: "All the other planets in our solar system could fit side by side between Earth and the Moon. Apollo took about 3 days to cross that gap.",
  },
  {
    id: "solar-storms",
    zone: "moon",
    tag: "Space Weather",
    title: "Solar Particle Storms",
    text: "Beyond Earth's magnetosphere, crews rely on storm shelters and dosimetry to stay safe during Coronal Mass Ejections.",
  },
  {
    id: "reentry",
    zone: "reentry",
    tag: "Reentry Fact",
    title: "Reentry Plasma Shield",
    text: "Returning from orbit compresses air ahead of your spacecraft to over 1,600°C, turning it into glowing plasma. Your heat shield sheds that energy.",
  },
];

interface TriviaQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

const SPACE_TRIVIA: TriviaQuestion[] = [
  {
    id: "t1",
    question: "At what altitude does the internationally recognized Karman line (space boundary) sit?",
    options: ["50 km", "100 km", "400 km"],
    correctIndex: 1,
    explanation: "100 km! Above this line, aerodynamic lift can no longer support a winged craft.",
  },
  {
    id: "t2",
    question: "Why do most orbital rockets launch eastward?",
    options: ["Less cloud cover", "Earth's rotation speed boost", "Stronger gravity"],
    correctIndex: 1,
    explanation: "Launching east adds Earth's rotational velocity (~465 m/s at the equator) for free!",
  },
  {
    id: "t3",
    question: "Roughly how fast do you need to travel to stay in Low Earth Orbit?",
    options: ["1.2 km/s", "7.8 km/s", "25.0 km/s"],
    correctIndex: 1,
    explanation: "~7.8 km/s (28,000 km/h) sideways so your fall curves around Earth!",
  },
  {
    id: "t4",
    question: "What protects a capsule from >1,600°C plasma during reentry?",
    options: ["Solar panels", "Ablative heat shield", "RCS thrusters"],
    correctIndex: 1,
    explanation: "The heat shield chars and ablates away, carrying intense heat away from the crew.",
  },
  {
    id: "t5",
    question: "What is the approximate average distance from Earth to the Moon?",
    options: ["38,400 km", "384,400 km", "3,840,000 km"],
    correctIndex: 1,
    explanation: "About 384,400 km — roughly 30 Earth diameters away!",
  },
  {
    id: "t6",
    question: "In Artemis II, what kind of trajectory loops around the Moon and brings the crew back to Earth?",
    options: ["Geostationary orbit", "Free-return / lunar flyby", "Polar sun-synchronous"],
    correctIndex: 1,
    explanation: "A free-return trajectory uses the Moon's gravity to swing back toward Earth safely.",
  },
  {
    id: "t7",
    question: "Why do rockets drop empty booster stages during ascent?",
    options: ["To reduce dead mass", "To cool the engines", "To increase drag"],
    correctIndex: 0,
    explanation: "Shedding empty tanks lets the remaining stages accelerate much faster with less fuel!",
  },
  {
    id: "t8",
    question: "What hazard do Coronal Mass Ejections (CMEs) pose in deep space?",
    options: ["High-energy radiation", "Freezing ocean waves", "Extra atmospheric drag"],
    correctIndex: 0,
    explanation: "CMEs send high-energy solar protons; beyond Earth's magnetic field, crews need storm shelters.",
  },
  {
    id: "t9",
    question: "At which point in an elliptical orbit does a spacecraft move the fastest?",
    options: ["Apoapsis (highest point)", "Periapsis (lowest point)", "Everywhere equally"],
    correctIndex: 1,
    explanation: "By Kepler's second law, orbital speed peaks at periapsis, closest to the planet!",
  },
  {
    id: "t10",
    question: "What does 'delta-v' measure in spaceflight?",
    options: ["Cabin air pressure", "Total velocity change budget", "Rocket height"],
    correctIndex: 1,
    explanation: "Delta-v is how much your rocket can change its velocity — your true 'currency' for maneuvers.",
  },
  {
    id: "t11",
    question: "How strong is gravity on the Moon compared to Earth?",
    options: ["About 1/6th of Earth's", "Zero gravity", "Half of Earth's"],
    correctIndex: 0,
    explanation: "Lunar surface gravity is ~1.62 m/s², roughly one-sixth of Earth's 9.81 m/s².",
  },
  {
    id: "t12",
    question: "Which Apollo mission was the first to carry astronauts into lunar orbit?",
    options: ["Apollo 7", "Apollo 8", "Apollo 11"],
    correctIndex: 1,
    explanation: "Apollo 8 orbited the Moon in December 1968 and captured the iconic 'Earthrise' photo.",
  },
  {
    id: "t13",
    question: "What happens if a spacecraft hits Earth's atmosphere at too steep an angle?",
    options: ["Extreme g-forces and heat", "It bounces into deep space", "Fuel freezes"],
    correctIndex: 0,
    explanation: "Too steep causes dangerous deceleration (high g) and overheating; too shallow skips back out!",
  },
  {
    id: "t14",
    question: "Why do astronauts appear weightless inside an orbiting spacecraft?",
    options: ["No gravity exists in orbit", "Air pressure pushes them up", "They and the ship fall together"],
    correctIndex: 2,
    explanation: "At ISS altitude gravity is still ~90% as strong — everything is in continuous free fall together!",
  },
];

interface PersonaSprites {
  icon: string;
  front: string[];
  happy: string[];
  sad: string[];
  moving: string[];
  label: string;
}

const PERSONA_SPRITES: Record<AiPersona, PersonaSprites> = {
  earth: {
    icon: aiIcon,
    front: [aiFront1, aiFront2],
    happy: [aiHappy1, aiHappy2],
    sad: [aiSad1, aiSad2],
    moving: [aiMoving1, aiMoving2],
    label: "Guide",
  },
  planning: {
    icon: aiIcon,
    front: [aiFront1, aiFront2],
    happy: [aiHappy1, aiHappy2],
    sad: [aiSad1, aiSad2],
    moving: [aiMoving1, aiMoving2],
    label: "Guide",
  },
  space: {
    icon: aiSpaceIcon,
    front: [aiSpaceFront1, aiSpaceFront2],
    happy: [aiSpaceHappy1, aiSpaceHappy2],
    sad: [aiSpaceSad1, aiSpaceSad2],
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
const AUTO_CLOSE_MS = 11000;
const SPONTANEOUS_MIN_MS = 25000;
const SPONTANEOUS_MAX_MS = 35000;

interface StagePosition {
  x: number;
  y: number;
  bubbleSide: "left" | "right";
}

function getAfkCoords(vw: number): { x: number; y: number } {
  return { x: vw / 2 - 44, y: 66 };
}

function getStageDimensions(vw: number, vh: number) {
  const spriteW = Math.min(300, Math.max(220, vw * 0.22));
  const bubbleW = Math.min(340, Math.max(240, vw - spriteW - 48));
  const stageW = spriteW + 12 + bubbleW;
  const stageH = Math.min(350, Math.max(260, vh * 0.38));
  return { spriteW, bubbleW, stageW, stageH };
}

function computeStagePosition(
  persona: AiPersona,
  anchorIndex: number,
  rect: SpotlightRect | null,
  placement: TutorialStep["placement"],
  vw: number,
  vh: number,
): StagePosition {
  const { stageW, stageH } = getStageDimensions(vw, vh);
  const clampX = (x: number) => Math.max(12, Math.min(vw - stageW - 12, x));
  const clampY = (y: number) => Math.max(66, Math.min(vh - stageH - 16, y));

  if (persona === "space") {
    const spaceAnchors: StagePosition[] = [
      { x: clampX(20), y: clampY(76), bubbleSide: "right" },
      { x: clampX(vw * 0.24), y: clampY(108), bubbleSide: "right" },
      { x: clampX(24), y: clampY(vh - stageH - 110), bubbleSide: "right" },
      { x: clampX(vw - stageW - 330), y: clampY(vh - stageH - 110), bubbleSide: "left" },
    ];
    return spaceAnchors[anchorIndex % spaceAnchors.length];
  }

  if (!rect || placement === "center") {
    const earthCenterAnchors: StagePosition[] = [
      { x: clampX((vw - stageW) / 2), y: clampY((vh - stageH) / 2), bubbleSide: "right" },
      { x: clampX((vw - stageW) / 2 - 40), y: clampY(96), bubbleSide: "right" },
      { x: clampX((vw - stageW) / 2 + 40), y: clampY(vh - stageH - 120), bubbleSide: "left" },
    ];
    return earthCenterAnchors[anchorIndex % earthCenterAnchors.length];
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

function getFlightZone(tel?: Telemetry | null): FlightZone {
  if (!tel) return "atmosphere";
  const p = tel.phase.toLowerCase();
  if (p.includes("reentry") || p.includes("splash") || p.includes("landing")) return "reentry";
  if (p.includes("moon") || p.includes("lunar") || tel.moonDistance < 90_000_000) return "moon";
  if (tel.altitude >= 100_000) return "orbit";
  return "atmosphere";
}

function getLiveDiagnosis(tel?: Telemetry | null): { title: string; text: string } {
  if (!tel) {
    return {
      title: "Standing By",
      text: "Telemetry is initializing. Keep an eye on altitude, fuel, and your orbital path.",
    };
  }
  const p = tel.phase.toLowerCase();
  if (tel.failed) {
    return {
      title: "Mission Alert",
      text: tel.message || "Mission parameters went out of bounds. Head back to planning or assembly to adjust your build.",
    };
  }
  if (tel.done) {
    return {
      title: "Mission Complete!",
      text: "Splashdown confirmed! Great flying, commander — review your telemetry or start a new mission.",
    };
  }
  if (p.includes("countdown")) {
    return {
      title: "Terminal Countdown",
      text: "Hold steady on the pad. Main engines ignite at T-0; autopilot will handle the initial vertical climb.",
    };
  }
  if (tel.fuel <= 0.08 && !p.includes("coast") && !p.includes("reentry")) {
    return {
      title: "Low Fuel Warning",
      text: "Propellant in this stage is nearly depleted. Prepare for stage separation or conserve throttle.",
    };
  }
  if (tel.altitude < 100_000) {
    return {
      title: "Atmospheric Ascent",
      text: "Climbing through dense air. Pitching smoothly east builds horizontal speed toward orbit.",
    };
  }
  if (tel.moonDistance < 60_000_000) {
    return {
      title: "Lunar Vicinity",
      text: "Approaching the Moon! Check your periapsis in Map View (M) and manage your burn carefully.",
    };
  }
  return {
    title: tel.phase,
    text: tel.autopilot
      ? "Autopilot is steering your trajectory. Use Map View (M) or Time Warp (, / .) to monitor your orbit."
      : "You have manual control (WASD + Shift/Ctrl). Press T anytime if you want Autopilot to take over.",
  };
}

function getWeatherSummary(weather?: WeatherState, timeOfDay?: number): {
  title: string;
  text: string;
  emotion: "happy" | "sad" | "front";
} {
  const hour = timeOfDay ?? 8.6;
  const isNight = hour < 6 || hour >= 19.5;
  const timeNote = isNight
    ? "Nighttime lighting highlights city lights and pad floodlights."
    : "Daylight gives crisp horizon and cloud contrast.";

  switch (weather) {
    case "storm":
      return {
        title: "Storm Conditions",
        text: `Thunderstorms and lightning are active around the pad! Launch visibility is low — consider switching to Clear or Cloudy. ${timeNote}`,
        emotion: "sad",
      };
    case "rain":
      return {
        title: "Rainy Pad",
        text: `Thick rain clouds cover the launch site. ${timeNote}`,
        emotion: "front",
      };
    case "clear":
      return {
        title: "Clear Skies",
        text: `Ideal launch visibility with minimal cloud cover! ${timeNote}`,
        emotion: "happy",
      };
    case "cloudy":
    default:
      return {
        title: "Partly Cloudy",
        text: `Scattered clouds drift over the launch complex. ${timeNote}`,
        emotion: "front",
      };
  }
}

interface MilestoneNotice {
  tag: string;
  title: string;
  text: string;
  emotion?: "happy" | "sad" | "front";
  voiceClip?: string;
}

interface TutorialOverlayProps {
  persona: AiPersona;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canLaunch?: boolean;
  buildIssues?: string[];
  weather?: WeatherState;
  timeOfDay?: number;
  stormExposed?: boolean;
  telemetry?: Telemetry | null;
  mapView?: boolean;
  onToggleMap?: () => void;
  onToggleAutopilot?: () => void;
}

export function TutorialOverlay({
  persona,
  open,
  onOpenChange,
  canLaunch = false,
  buildIssues = [],
  weather,
  timeOfDay,
  stormExposed = false,
  telemetry,
  mapView = false,
  onToggleMap,
  onToggleAutopilot,
}: TutorialOverlayProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [earthMode, setEarthMode] = useState<EarthMode>("tutorial");
  const [hasSeenTutorial, setHasSeenTutorial] = useState(false);
  const [hasSeenPlanTutorial, setHasSeenPlanTutorial] = useState(false);

  const [factIndex, setFactIndex] = useState(0);
  const [spaceTab, setSpaceTab] = useState<SpaceTab>("status");
  const [triviaIndex, setTriviaIndex] = useState(0);
  const [triviaPick, setTriviaPick] = useState<number | null>(null);
  const [triviaScore, setTriviaScore] = useState(0);
  const [triviaAttempted, setTriviaAttempted] = useState(0);

  const [anchorSeed, setAnchorSeed] = useState(0);
  const [frameIndex, setFrameIndex] = useState(0);
  const [rect, setRect] = useState<SpotlightRect | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  const [facingRight, setFacingRight] = useState(false);
  const [closingToAfk, setClosingToAfk] = useState(false);

  const [autoNotice, setAutoNotice] = useState<MilestoneNotice | null>(null);
  const [autoClosingActive, setAutoClosingActive] = useState(false);
  const [happyBoost, setHappyBoost] = useState(false);
  const [sadBoost, setSadBoost] = useState(false);

  // Free drag position state
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{
    startPointerX: number;
    startPointerY: number;
    startStageX: number;
    startStageY: number;
    lastPointerX: number;
  } | null>(null);

  const prevStageXRef = useRef<number | null>(null);
  const prevCanLaunchRef = useRef<boolean>(canLaunch);
  const prevWeatherRef = useRef<WeatherState | undefined>(weather);
  const seenMilestonesRef = useRef<Set<string>>(new Set());
  const spontaneousCountRef = useRef(0);
  const moveTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const autoCloseTimerRef = useRef<number | null>(null);
  const spontaneousTimerRef = useRef<number | null>(null);
  const happyTimerRef = useRef<number | null>(null);
  const sadTimerRef = useRef<number | null>(null);

  const sprites = PERSONA_SPRITES[persona];
  const zone = getFlightZone(telemetry);
  const zoneFacts = SPACE_FACTS.filter((f) => f.zone === zone);
  const orderedFacts = [
    ...zoneFacts,
    ...SPACE_FACTS.filter((f) => f.zone !== zone),
  ];

  const groundSteps = persona === "planning" ? PLANNING_STEPS : EARTH_STEPS;
  const earthStep = groundSteps[stepIndex] ?? groundSteps[0];
  const currentFact = orderedFacts[factIndex % orderedFacts.length] ?? SPACE_FACTS[0];
  const currentTrivia = SPACE_TRIVIA[triviaIndex % SPACE_TRIVIA.length];
  const isEarthFirst = stepIndex === 0;
  const isEarthLast = stepIndex === groundSteps.length - 1;

  const clearAutoCloseTimer = useCallback(() => {
    if (autoCloseTimerRef.current !== null) {
      window.clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
    setAutoClosingActive(false);
  }, []);

  const clearSpontaneousTimer = useCallback(() => {
    if (spontaneousTimerRef.current !== null) {
      window.clearTimeout(spontaneousTimerRef.current);
      spontaneousTimerRef.current = null;
    }
  }, []);

  // Reset transient state when switching personas
  useEffect(() => {
    setStepIndex(0);
    setEarthMode(
      persona === "planning"
        ? hasSeenPlanTutorial
          ? "menu"
          : "tutorial"
        : persona === "earth"
          ? hasSeenTutorial
            ? "menu"
            : "tutorial"
          : "tutorial",
    );
    setFactIndex(0);
    setFrameIndex(0);
    setIsMoving(false);
    setClosingToAfk(false);
    setAutoNotice(null);
    setHappyBoost(false);
    setSadBoost(false);
    setDragPos(null);
    setIsDragging(false);
    prevStageXRef.current = null;
    seenMilestonesRef.current.clear();
    clearAutoCloseTimer();
    clearSpontaneousTimer();
    stopAiVoice();
    if (moveTimerRef.current !== null) {
      window.clearTimeout(moveTimerRef.current);
      moveTimerRef.current = null;
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (happyTimerRef.current !== null) {
      window.clearTimeout(happyTimerRef.current);
      happyTimerRef.current = null;
    }
    if (sadTimerRef.current !== null) {
      window.clearTimeout(sadTimerRef.current);
      sadTimerRef.current = null;
    }
  }, [persona, clearAutoCloseTimer, clearSpontaneousTimer]);

  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 720;
  const afkCoords = getAfkCoords(vw);

  const activeAnchorIndex =
    persona === "space"
      ? factIndex + anchorSeed
      : earthMode === "tutorial" && !autoNotice
        ? stepIndex
        : anchorSeed;

  const defaultPos = computeStagePosition(
    persona,
    activeAnchorIndex,
    earthMode === "tutorial" && !autoNotice ? rect : null,
    earthStep.placement,
    vw,
    vh,
  );
  const activeX = dragPos ? dragPos.x : defaultPos.x;
  const activeY = dragPos ? dragPos.y : defaultPos.y;
  const { stageW } = getStageDimensions(vw, vh);
  const activeBubbleSide: "left" | "right" = dragPos
    ? activeX + stageW > vw - 24 || activeX > vw * 0.56
      ? "left"
      : "right"
    : defaultPos.bubbleSide;

  const handleClose = useCallback(() => {
    if (closingToAfk || !open) return;
    clearAutoCloseTimer();
    stopAiVoice();
    if (persona === "earth") {
      setHasSeenTutorial(true);
    } else if (persona === "planning") {
      setHasSeenPlanTutorial(true);
    }
    setAutoNotice(null);
    setFacingRight(afkCoords.x > activeX);
    setClosingToAfk(true);
    closeTimerRef.current = window.setTimeout(() => {
      setClosingToAfk(false);
      setDragPos(null);
      closeTimerRef.current = null;
      onOpenChange(false);
    }, MOVE_DURATION_MS);
  }, [closingToAfk, open, clearAutoCloseTimer, persona, afkCoords.x, activeX, onOpenChange]);

  const handleCloseRef = useRef(handleClose);
  handleCloseRef.current = handleClose;

  const scheduleAutoHide = useCallback(
    (durationMs = AUTO_CLOSE_MS) => {
      clearAutoCloseTimer();
      setAutoClosingActive(true);
      autoCloseTimerRef.current = window.setTimeout(() => {
        autoCloseTimerRef.current = null;
        setAutoClosingActive(false);
        handleCloseRef.current();
      }, durationMs);
    },
    [clearAutoCloseTimer],
  );

  const triggerAutoNotice = useCallback(
    (notice: MilestoneNotice, durationMs = AUTO_CLOSE_MS) => {
      if (closingToAfk) return;
      setDragPos(null);
      setAnchorSeed((s) => s + 1);
      setAutoNotice(notice);
      onOpenChange(true);
      scheduleAutoHide(durationMs);
    },
    [closingToAfk, onOpenChange, scheduleAutoHide],
  );

  // Spontaneous "alive" popups every 25-35s when minimized
  useEffect(() => {
    clearSpontaneousTimer();
    if (open || closingToAfk) return;

    const delayMs =
      SPONTANEOUS_MIN_MS + Math.random() * (SPONTANEOUS_MAX_MS - SPONTANEOUS_MIN_MS);

    spontaneousTimerRef.current = window.setTimeout(() => {
      spontaneousTimerRef.current = null;
      const count = spontaneousCountRef.current++;
      setDragPos(null);
      setAnchorSeed((s) => s + 1);

      // Every 3rd spontaneous appearance challenges the user with a quick Trivia question
      if (count % 3 === 2) {
        setAutoNotice(null);
        setTriviaPick(null);
        setTriviaIndex((i) => (i + 1) % SPACE_TRIVIA.length);
        if (persona === "earth") {
          setEarthMode("trivia");
        } else {
          setSpaceTab("trivia");
        }
        onOpenChange(true);
        scheduleAutoHide(AUTO_CLOSE_MS);
        return;
      }

      if (persona === "earth") {
        if (weather === "storm") {
          triggerAutoNotice({
            tag: "Pad Check",
            title: "Stormy Skies Overhead",
            text: "Lightning is flashing near the pad! You can switch weather anytime in the bottom bar.",
            emotion: "sad",
            voiceClip: "/audio/voice/earth_ai/earth_storm.mp3",
          });
        } else if (canLaunch) {
          triggerAutoNotice({
            tag: "Ready!",
            title: "Rocket Looking Great",
            text: "All launch gauges are green! Hit Plan the orbit whenever you're ready to fly.",
            emotion: "happy",
            voiceClip: "/audio/voice/earth_ai/earth_cleared.mp3",
          });
        } else {
          const fact = SPACE_FACTS[count % SPACE_FACTS.length];
          triggerAutoNotice({
            tag: fact.tag,
            title: fact.title,
            text: fact.text,
            emotion: "front",
          });
        }
      } else {
        const fact = orderedFacts[count % orderedFacts.length] ?? SPACE_FACTS[0];
        triggerAutoNotice({
          tag: fact.tag,
          title: fact.title,
          text: fact.text,
          emotion: count % 2 === 0 ? "happy" : "front",
        });
      }
    }, delayMs);

    return clearSpontaneousTimer;
  }, [
    open,
    closingToAfk,
    persona,
    weather,
    canLaunch,
    orderedFacts,
    onOpenChange,
    scheduleAutoHide,
    triggerAutoNotice,
    clearSpontaneousTimer,
  ]);

  // Earth AI: celebrate with Happy when readiness turns green while minimized
  useEffect(() => {
    const prev = prevCanLaunchRef.current;
    prevCanLaunchRef.current = canLaunch;
    if (persona === "earth" && !prev && canLaunch && !open && !closingToAfk) {
      triggerAutoNotice({
        tag: "Cleared!",
        title: "Ready for Launch",
        text: "Every gauge is green! Hit Plan the orbit or Launch with autopilot plan whenever you're ready.",
        emotion: "happy",
        voiceClip: "/audio/voice/earth_ai/earth_cleared.mp3",
      });
    }
  }, [persona, canLaunch, open, closingToAfk, triggerAutoNotice]);

  // Earth AI: warn with Sad when Storm weather is selected while minimized
  useEffect(() => {
    const prevW = prevWeatherRef.current;
    prevWeatherRef.current = weather;
    if (
      persona === "earth" &&
      prevW !== "storm" &&
      weather === "storm" &&
      !open &&
      !closingToAfk
    ) {
      triggerAutoNotice({
        tag: "Weather Alert",
        title: "Storm at the Launch Pad",
        text: "Heavy storm clouds and lightning are active at the pad — launch conditions may be hazardous!",
        emotion: "sad",
        voiceClip: "/audio/voice/earth_ai/earth_storm.mp3",
      });
    }
  }, [persona, weather, open, closingToAfk, triggerAutoNotice]);

  // Space AI: react automatically on key flight milestones, mission failure, or storm exposure
  useEffect(() => {
    if (persona !== "space" || !telemetry) return;

    if (telemetry.t < 2) {
      seenMilestonesRef.current.clear();
    }

    const triggerOnce = (key: string, notice: MilestoneNotice) => {
      if (seenMilestonesRef.current.has(key)) return;
      seenMilestonesRef.current.add(key);
      if (!open && !closingToAfk) {
        triggerAutoNotice(notice, AUTO_CLOSE_MS);
      }
    };

    if (telemetry.failed) {
      triggerOnce("failed", {
        tag: "Alert",
        title: "Mission Failed",
        text: telemetry.message || "Something went wrong on this flight. Review telemetry and try another run.",
        emotion: "sad",
        voiceClip: "/audio/voice/space_ai/space_failed_sad.mp3",
      });
    } else if (stormExposed) {
      triggerOnce("stormExposed", {
        tag: "Radiation Alert",
        title: "Crew Exposed to Storm",
        text: "The solar storm hit without a Radiation Storm Shelter. Add shielding in Assembly next time!",
        emotion: "sad",
        voiceClip: "/audio/voice/space_ai/space_radiation_sad.mp3",
      });
    } else if (telemetry.done) {
      triggerOnce("done", {
        tag: "Milestone",
        title: "Mission Complete!",
        text: "Welcome home, commander! Splashdown achieved — outstanding flight.",
        emotion: "happy",
        voiceClip: "/audio/voice/space_ai/space_complete.mp3",
      });
    } else if (telemetry.moonDistance < 60_000_000) {
      triggerOnce("moon", {
        tag: "Milestone",
        title: "Lunar Approach!",
        text: "You've reached the Moon's neighborhood! Watch your periapsis in Map View (M).",
        emotion: "happy",
        voiceClip: "/audio/voice/space_ai/space_moon.mp3",
      });
    } else if (
      telemetry.altitude >= 100_000 &&
      telemetry.periapsis > 60_000 &&
      !telemetry.phase.toLowerCase().includes("ascent")
    ) {
      triggerOnce("orbit", {
        tag: "Milestone",
        title: "Orbit Achieved!",
        text: "You're in stable orbit — falling around Earth at orbital velocity!",
        emotion: "happy",
        voiceClip: "/audio/voice/space_ai/space_orbit.mp3",
      });
    } else if (telemetry.altitude >= 100_000) {
      triggerOnce("karman", {
        tag: "Milestone",
        title: "Karman Line Crossed!",
        text: "100 km altitude reached — welcome to outer space!",
        emotion: "happy",
        voiceClip: "/audio/voice/space_ai/space_karman.mp3",
      });
    }
  }, [persona, telemetry, stormExposed, open, closingToAfk, triggerAutoNotice]);

  // Play pre-recorded Fish Audio voice lines matching the active AI state
  useEffect(() => {
    if (!open || closingToAfk) {
      stopAiVoice();
      return;
    }

    if (autoNotice) {
      if (autoNotice.voiceClip) playAiVoice(autoNotice.voiceClip);
      else stopAiVoice();
      return;
    }

    if (persona === "earth" || persona === "planning") {
      if (earthMode === "tutorial") {
        if (earthStep.voiceClip) playAiVoice(earthStep.voiceClip);
        else stopAiVoice();
      } else if (earthMode === "menu" && persona === "earth") {
        playAiVoice("/audio/voice/earth_ai/earth_menu.mp3");
      } else if (earthMode === "weather" && weather === "storm") {
        playAiVoice("/audio/voice/earth_ai/earth_storm.mp3");
      } else if (earthMode === "check" && canLaunch) {
        playAiVoice("/audio/voice/earth_ai/earth_cleared.mp3");
      } else if (earthMode === "trivia" && triviaPick === null) {
        playAiVoice("/audio/voice/space_ai/space_trivia_ask.mp3");
      } else if (earthMode !== "trivia") {
        stopAiVoice();
      }
      return;
    }

    if (persona === "space") {
      if (spaceTab === "trivia" && triviaPick === null) {
        playAiVoice("/audio/voice/space_ai/space_trivia_ask.mp3");
      } else if (spaceTab !== "trivia") {
        stopAiVoice();
      }
    }
  }, [
    open,
    closingToAfk,
    autoNotice,
    persona,
    earthMode,
    earthStep.voiceClip,
    spaceTab,
    triviaIndex,
    triviaPick,
    weather,
    canLaunch,
  ]);

  const isGround = persona === "earth" || persona === "planning";

  // Determine current emotion state for sprite animation
  const weatherSummary = getWeatherSummary(weather, timeOfDay);
  const isSadMoment =
    sadBoost ||
    autoNotice?.emotion === "sad" ||
    (persona === "earth" &&
      !autoNotice &&
      ((earthMode === "tutorial" && weather === "storm" && earthStep.id === "environment") ||
        (earthMode === "weather" && weather === "storm") ||
        (earthMode === "check" && !canLaunch))) ||
    (persona === "space" &&
      !autoNotice &&
      spaceTab === "status" &&
      (Boolean(telemetry?.failed) || stormExposed));

  const isHappyMoment =
    !isSadMoment &&
    (happyBoost ||
      autoNotice?.emotion === "happy" ||
      (isGround &&
        !autoNotice &&
        ((earthMode === "tutorial" && earthStep.emotion === "happy") ||
          (earthMode === "check" && canLaunch) ||
          (earthMode === "weather" && weatherSummary.emotion === "happy"))));

  const activeAnimState: AiAnimState =
    isMoving || closingToAfk || isDragging
      ? "moving"
      : isSadMoment
        ? "sad"
        : isHappyMoment
          ? "happy"
          : "front";

  // Animate sprite frames
  useEffect(() => {
    if (!open && !closingToAfk) return;
    const activeFrames = sprites[activeAnimState];
    const intervalMs =
      activeAnimState === "moving"
        ? 160
        : activeAnimState === "happy" || activeAnimState === "sad"
          ? 360
          : 480;
    const id = window.setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % activeFrames.length);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [open, closingToAfk, activeAnimState, sprites]);

  // Measure target for Earth spotlight
  const measureTarget = useCallback(
    (scrollIntoView: boolean) => {
      if (
        !open ||
        closingToAfk ||
        persona === "space" ||
        autoNotice ||
        earthMode !== "tutorial" ||
        !earthStep.targetSelector
      ) {
        setRect(null);
        return;
      }
      const el = document.querySelector(earthStep.targetSelector);
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

      const curVw = window.innerWidth;
      const curVh = window.innerHeight;
      const paddedTop = Math.max(0, top - SPOTLIGHT_PAD);
      const paddedLeft = Math.max(0, left - SPOTLIGHT_PAD);
      const paddedRight = Math.min(curVw, right + SPOTLIGHT_PAD);
      const paddedBottom = Math.min(curVh, bottom + SPOTLIGHT_PAD);

      setRect({
        top: paddedTop,
        left: paddedLeft,
        width: Math.max(0, paddedRight - paddedLeft),
        height: Math.max(0, paddedBottom - paddedTop),
      });
    },
    [open, closingToAfk, persona, autoNotice, earthMode, earthStep.targetSelector],
  );

  useLayoutEffect(() => {
    measureTarget(true);
  }, [measureTarget]);

  useEffect(() => {
    if (!open || closingToAfk || persona === "space" || autoNotice || earthMode !== "tutorial") {
      return;
    }
    const onResizeOrScroll = () => measureTarget(false);
    window.addEventListener("resize", onResizeOrScroll);
    window.addEventListener("scroll", onResizeOrScroll, true);
    return () => {
      window.removeEventListener("resize", onResizeOrScroll);
      window.removeEventListener("scroll", onResizeOrScroll, true);
    };
  }, [open, closingToAfk, persona, autoNotice, earthMode, measureTarget]);

  // Trigger moving sprite when AI glides automatically between anchors
  useEffect(() => {
    if (!open || closingToAfk || isDragging || dragPos) {
      prevStageXRef.current = activeX;
      setIsMoving(false);
      return;
    }

    const prevX = prevStageXRef.current;
    prevStageXRef.current = activeX;

    if (prevX !== null && Math.abs(activeX - prevX) > 12) {
      setFacingRight(activeX > prevX);
      setIsMoving(true);
      if (moveTimerRef.current !== null) {
        window.clearTimeout(moveTimerRef.current);
      }
      moveTimerRef.current = window.setTimeout(() => {
        setIsMoving(false);
        moveTimerRef.current = null;
      }, MOVE_DURATION_MS);
    }
  }, [open, closingToAfk, isDragging, dragPos, activeX]);

  useEffect(() => {
    return () => {
      stopAiVoice();
      if (moveTimerRef.current !== null) window.clearTimeout(moveTimerRef.current);
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
      if (autoCloseTimerRef.current !== null) window.clearTimeout(autoCloseTimerRef.current);
      if (spontaneousTimerRef.current !== null) window.clearTimeout(spontaneousTimerRef.current);
      if (happyTimerRef.current !== null) window.clearTimeout(happyTimerRef.current);
      if (sadTimerRef.current !== null) window.clearTimeout(sadTimerRef.current);
    };
  }, []);

  // Mouse / pointer dragging on the character
  useEffect(() => {
    if (!isDragging) return;
    const onPointerMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startPointerX;
      const dy = e.clientY - d.startPointerY;
      if (Math.abs(e.clientX - d.lastPointerX) > 1) {
        setFacingRight(e.clientX > d.lastPointerX);
      }
      d.lastPointerX = e.clientX;
      const curVw = window.innerWidth;
      const curVh = window.innerHeight;
      const { stageW: sw, stageH: sh } = getStageDimensions(curVw, curVh);
      setDragPos({
        x: Math.max(8, Math.min(curVw - sw - 8, d.startStageX + dx)),
        y: Math.max(58, Math.min(curVh - sh - 8, d.startStageY + dy)),
      });
    };
    const onPointerUp = () => {
      setIsDragging(false);
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [isDragging]);

  const handleSpritePointerDown = (e: React.PointerEvent<HTMLImageElement>) => {
    if (closingToAfk) return;
    e.preventDefault();
    clearAutoCloseTimer();
    dragRef.current = {
      startPointerX: e.clientX,
      startPointerY: e.clientY,
      startStageX: activeX,
      startStageY: activeY,
      lastPointerX: e.clientX,
    };
    setIsDragging(true);
  };

  useEffect(() => {
    if (!open || closingToAfk || autoNotice) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      } else if ((persona === "earth" || persona === "planning") && earthMode === "tutorial") {
        if (e.key === "ArrowRight") {
          if (isEarthLast) handleClose();
          else {
            setDragPos(null);
            setStepIndex((i) => Math.min(groundSteps.length - 1, i + 1));
          }
        } else if (e.key === "ArrowLeft" && !isEarthFirst) {
          setDragPos(null);
          setStepIndex((i) => Math.max(0, i - 1));
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, closingToAfk, autoNotice, persona, earthMode, isEarthFirst, isEarthLast, groundSteps.length, handleClose]);

  const handleOpenManual = () => {
    clearAutoCloseTimer();
    clearSpontaneousTimer();
    stopAiVoice();
    setAutoNotice(null);
    setDragPos(null);
    if (persona === "earth") {
      setEarthMode(hasSeenTutorial ? "menu" : "tutorial");
      setStepIndex(0);
    } else if (persona === "planning") {
      setEarthMode(hasSeenPlanTutorial ? "menu" : "tutorial");
      setStepIndex(0);
    }
    onOpenChange(true);
  };

  const handleEarthNext = () => {
    clearAutoCloseTimer();
    setDragPos(null);
    if (isEarthLast) handleClose();
    else setStepIndex((i) => Math.min(groundSteps.length - 1, i + 1));
  };

  const handleEarthBack = () => {
    clearAutoCloseTimer();
    setDragPos(null);
    setStepIndex((i) => Math.max(0, i - 1));
  };

  const handleSpaceTabChange = (tab: SpaceTab) => {
    clearAutoCloseTimer();
    setAutoNotice(null);
    setSpaceTab(tab);
  };

  const renderTriviaBlock = (onHide: () => void) => (
    <>
      <div className="tutorial-header">
        <span className="tutorial-step-pill">
          Q{(triviaIndex % SPACE_TRIVIA.length) + 1}/{SPACE_TRIVIA.length}
        </span>
        <h3 className="tutorial-title">Space Trivia</h3>
        {triviaAttempted > 0 && (
          <span className="tutorial-score-pill">
            Score {triviaScore}/{triviaAttempted}
          </span>
        )}
      </div>
      <p className="tutorial-text">{currentTrivia.question}</p>
      <div className="tutorial-trivia-options">
        {currentTrivia.options.map((opt, idx) => {
          const answered = triviaPick !== null;
          const isCorrect = idx === currentTrivia.correctIndex;
          const isPicked = idx === triviaPick;
          const cls = answered
            ? isCorrect
              ? "correct"
              : isPicked
                ? "wrong"
                : ""
            : "";
          return (
            <button
              key={opt}
              type="button"
              className={`tutorial-trivia-opt ${cls}`}
              disabled={answered}
              onClick={() => {
                clearAutoCloseTimer();
                setTriviaPick(idx);
                setTriviaAttempted((n) => n + 1);
                if (idx === currentTrivia.correctIndex) {
                  setTriviaScore((s) => s + 1);
                  playAiVoice("/audio/voice/space_ai/space_trivia_happy.mp3");
                  if (happyTimerRef.current !== null) {
                    window.clearTimeout(happyTimerRef.current);
                  }
                  setSadBoost(false);
                  setHappyBoost(true);
                  happyTimerRef.current = window.setTimeout(() => {
                    setHappyBoost(false);
                    happyTimerRef.current = null;
                  }, 3500);
                } else {
                  playAiVoice("/audio/voice/space_ai/space_trivia_sad.mp3");
                  if (sadTimerRef.current !== null) {
                    window.clearTimeout(sadTimerRef.current);
                  }
                  setHappyBoost(false);
                  setSadBoost(true);
                  sadTimerRef.current = window.setTimeout(() => {
                    setSadBoost(false);
                    sadTimerRef.current = null;
                  }, 2500);
                }
              }}
            >
              {opt}
            </button>
          );
        })}
      </div>
      {triviaPick !== null && (
        <div className="tutorial-live-note">{currentTrivia.explanation}</div>
      )}
      <div className="tutorial-actions">
        <button type="button" className="tutorial-btn ghost" onClick={onHide}>
          Hide
        </button>
        <button
          type="button"
          className="tutorial-btn primary"
          onClick={() => {
            clearAutoCloseTimer();
            if (happyTimerRef.current !== null) {
              window.clearTimeout(happyTimerRef.current);
              happyTimerRef.current = null;
            }
            if (sadTimerRef.current !== null) {
              window.clearTimeout(sadTimerRef.current);
              sadTimerRef.current = null;
            }
            setHappyBoost(false);
            setSadBoost(false);
            setTriviaPick(null);
            setTriviaIndex((i) => (i + 1) % SPACE_TRIVIA.length);
          }}
        >
          Next Question
        </button>
      </div>
    </>
  );

  if (!open && !closingToAfk) {
    return (
      <button
        type="button"
        className={`tutorial-afk-btn ${persona === "space" ? "afk-space" : "afk-earth"}`}
        onClick={handleOpenManual}
        title={persona === "space" ? "Open Space AI Assistant" : "Open Mission Guide"}
        aria-label={persona === "space" ? "Open Space AI Assistant" : "Open Mission Guide"}
      >
        <img src={sprites.icon} alt={sprites.label} className="tutorial-afk-icon" />
        <span className="tutorial-afk-label">{sprites.label}</span>
      </button>
    );
  }

  const activeFrames = sprites[activeAnimState];
  const spriteSrc = activeFrames[frameIndex % activeFrames.length];
  const spriteFlip =
    (isMoving || closingToAfk || isDragging) && facingRight ? "scaleX(-1)" : "scaleX(1)";

  const targetX = closingToAfk ? afkCoords.x : activeX;
  const targetY = closingToAfk ? afkCoords.y : activeY;
  const diagnosis = getLiveDiagnosis(telemetry);
  const showSpotlightBackdrop =
    isGround && !closingToAfk && !autoNotice && earthMode === "tutorial";

  return (
    <div
      className={`tutorial-root ${persona === "space" ? "mode-space-ai" : ""}`}
      role="dialog"
      aria-modal={showSpotlightBackdrop}
      aria-label={persona === "space" ? "Space AI Assistant" : "Mission Tutorial"}
    >
      {showSpotlightBackdrop && (
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
        className={`tutorial-stage ${activeBubbleSide === "left" ? "bubble-left" : "bubble-right"} ${closingToAfk ? "closing-to-afk" : ""
          } ${isDragging ? "is-dragging" : ""}`}
        style={{ left: `${targetX}px`, top: `${targetY}px` }}
      >
        <img
          src={spriteSrc}
          alt={sprites.label}
          className="tutorial-sprite"
          style={{ transform: spriteFlip }}
          onPointerDown={handleSpritePointerDown}
          title="Drag me anywhere"
          draggable={false}
        />

        <div
          className={`tutorial-bubble ${closingToAfk ? "bubble-hidden" : ""}`}
          onMouseEnter={clearAutoCloseTimer}
          onPointerDown={clearAutoCloseTimer}
        >
          {autoNotice ? (
            <>
              <div className="tutorial-header">
                <span className="tutorial-step-pill">{autoNotice.tag}</span>
                <h3 className="tutorial-title">{autoNotice.title}</h3>
              </div>
              <p className="tutorial-text">{autoNotice.text}</p>
              <div className="tutorial-actions">
                <button type="button" className="tutorial-btn ghost" onClick={handleClose}>
                  Hide
                </button>
                {isGround && (
                  <button
                    type="button"
                    className="tutorial-btn primary"
                    onClick={() => {
                      clearAutoCloseTimer();
                      setAutoNotice(null);
                      setEarthMode("menu");
                    }}
                  >
                    Options
                  </button>
                )}
              </div>
            </>
          ) : isGround ? (
            earthMode === "tutorial" ? (
              <>
                <div className="tutorial-header">
                  <span className="tutorial-step-pill">
                    {stepIndex + 1} / {groundSteps.length}
                  </span>
                  <h3 className="tutorial-title">{earthStep.title}</h3>
                </div>
                <p className="tutorial-text">{earthStep.text}</p>
                <div className="tutorial-actions">
                  <button type="button" className="tutorial-btn ghost" onClick={handleClose}>
                    Skip
                  </button>
                  <div className="tutorial-nav">
                    {!isEarthFirst && (
                      <button type="button" className="tutorial-btn" onClick={handleEarthBack}>
                        Back
                      </button>
                    )}
                    <button type="button" className="tutorial-btn primary" onClick={handleEarthNext}>
                      {isEarthLast ? "Finish" : "Next"}
                    </button>
                  </div>
                </div>
              </>
            ) : earthMode === "menu" ? (
              <>
                <div className="tutorial-header">
                  <span className="tutorial-step-pill">
                    {persona === "planning" ? "Orbit Plan" : "Earth AI"}
                  </span>
                  <h3 className="tutorial-title">
                    {persona === "planning" ? "Need help planning the burn?" : "Need a hand on the pad?"}
                  </h3>
                </div>
                <p className="tutorial-text">
                  {persona === "planning"
                    ? "Repeat the Orbit Planner walkthrough, check your rocket readiness, or play Space Trivia."
                    : "Want to repeat the guided tutorial, inspect your rocket build, or test your space knowledge?"}
                </p>
                <div className="tutorial-menu-grid">
                  <button
                    type="button"
                    className="tutorial-btn primary"
                    onClick={() => {
                      setDragPos(null);
                      setStepIndex(0);
                      setEarthMode("tutorial");
                    }}
                  >
                    Repeat Tutorial
                  </button>
                  <button
                    type="button"
                    className="tutorial-btn"
                    onClick={() => setEarthMode("check")}
                  >
                    Check My Rocket
                  </button>
                  <button
                    type="button"
                    className="tutorial-btn"
                    onClick={() => setEarthMode("weather")}
                  >
                    Pad &amp; Weather
                  </button>
                  <button
                    type="button"
                    className="tutorial-btn"
                    onClick={() => setEarthMode("trivia")}
                  >
                    Rocket Trivia
                  </button>
                </div>
                <div className="tutorial-actions">
                  <button type="button" className="tutorial-btn ghost" onClick={handleClose}>
                    Hide
                  </button>
                </div>
              </>
            ) : earthMode === "check" ? (
              <>
                <div className="tutorial-header">
                  <span className="tutorial-step-pill">Build Check</span>
                  <h3 className="tutorial-title">
                    {canLaunch ? "All Systems Green!" : "Build Needs Attention"}
                  </h3>
                </div>
                {canLaunch ? (
                  <p className="tutorial-text">
                    Your spacecraft passes mass, delta-v, crew, and budget checks. You're cleared to plan your orbit or launch!
                  </p>
                ) : (
                  <ul className="tutorial-check-list">
                    {buildIssues.slice(0, 3).map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                )}
                <div className="tutorial-actions">
                  <button type="button" className="tutorial-btn ghost" onClick={handleClose}>
                    Hide
                  </button>
                  <button
                    type="button"
                    className="tutorial-btn"
                    onClick={() => setEarthMode("menu")}
                  >
                    Back
                  </button>
                </div>
              </>
            ) : earthMode === "weather" ? (
              <>
                <div className="tutorial-header">
                  <span className="tutorial-step-pill">Pad Weather</span>
                  <h3 className="tutorial-title">{weatherSummary.title}</h3>
                </div>
                <p className="tutorial-text">{weatherSummary.text}</p>
                <div className="tutorial-actions">
                  <button type="button" className="tutorial-btn ghost" onClick={handleClose}>
                    Hide
                  </button>
                  <button
                    type="button"
                    className="tutorial-btn"
                    onClick={() => setEarthMode("menu")}
                  >
                    Back
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="tutorial-tabs" role="tablist" aria-label="Earth AI modes">
                  <button
                    type="button"
                    className="tutorial-tab"
                    onClick={() => setEarthMode("menu")}
                  >
                    Menu
                  </button>
                  <button type="button" className="tutorial-tab active">
                    Trivia
                  </button>
                </div>
                {renderTriviaBlock(handleClose)}
              </>
            )
          ) : (
            <>
              <div className="tutorial-tabs" role="tablist" aria-label="Space AI modes">
                <button
                  type="button"
                  role="tab"
                  aria-selected={spaceTab === "status"}
                  className={`tutorial-tab ${spaceTab === "status" ? "active" : ""}`}
                  onClick={() => handleSpaceTabChange("status")}
                >
                  Status
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={spaceTab === "facts"}
                  className={`tutorial-tab ${spaceTab === "facts" ? "active" : ""}`}
                  onClick={() => handleSpaceTabChange("facts")}
                >
                  Facts
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={spaceTab === "trivia"}
                  className={`tutorial-tab ${spaceTab === "trivia" ? "active" : ""}`}
                  onClick={() => handleSpaceTabChange("trivia")}
                >
                  Trivia
                </button>
              </div>

              {spaceTab === "status" && (
                <>
                  <div className="tutorial-header">
                    <span className="tutorial-step-pill">Live</span>
                    <h3 className="tutorial-title">{diagnosis.title}</h3>
                  </div>
                  <p className="tutorial-text">{diagnosis.text}</p>
                  <div className="tutorial-quick-controls">
                    {onToggleAutopilot && (
                      <button type="button" className="tutorial-btn" onClick={onToggleAutopilot}>
                        Autopilot: {telemetry?.autopilot ? "ON" : "OFF"} (T)
                      </button>
                    )}
                    {onToggleMap && (
                      <button type="button" className="tutorial-btn" onClick={onToggleMap}>
                        Map: {mapView ? "ON" : "OFF"} (M)
                      </button>
                    )}
                  </div>
                  <div className="tutorial-actions">
                    <button type="button" className="tutorial-btn ghost" onClick={handleClose}>
                      Hide
                    </button>
                    <button
                      type="button"
                      className="tutorial-btn primary"
                      onClick={() => handleSpaceTabChange("facts")}
                    >
                      Fun Facts
                    </button>
                  </div>
                </>
              )}

              {spaceTab === "facts" && (
                <>
                  <div className="tutorial-header">
                    <span className="tutorial-step-pill">{currentFact.tag}</span>
                    <h3 className="tutorial-title">{currentFact.title}</h3>
                  </div>
                  <p className="tutorial-text">{currentFact.text}</p>
                  <div className="tutorial-actions">
                    <button type="button" className="tutorial-btn ghost" onClick={handleClose}>
                      Hide
                    </button>
                    <div className="tutorial-nav">
                      <button
                        type="button"
                        className="tutorial-btn"
                        onClick={() => {
                          setDragPos(null);
                          setFactIndex((i) => (i - 1 + orderedFacts.length) % orderedFacts.length);
                        }}
                      >
                        Prev
                      </button>
                      <button
                        type="button"
                        className="tutorial-btn primary"
                        onClick={() => {
                          setDragPos(null);
                          setFactIndex((i) => (i + 1) % orderedFacts.length);
                        }}
                      >
                        Next Fact
                      </button>
                    </div>
                  </div>
                </>
              )}

              {spaceTab === "trivia" && renderTriviaBlock(handleClose)}
            </>
          )}

          {autoClosingActive && (
            <div className="tutorial-auto-bar" aria-hidden="true">
              <div
                className="tutorial-auto-bar-fill"
                onAnimationEnd={() => handleCloseRef.current()}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
