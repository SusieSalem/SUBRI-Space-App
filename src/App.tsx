import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MISSION_REQUIREMENTS,
  PARTS,
  designIssues,
  togglePart,
  totals,
  type PartId,
} from "./core/design";
import { ROCKETS, ROCKETS_BY_ID, launchCheck, type RocketId } from "./core/launchCheck";
import { DEFAULT_PLAN, type OrbitPlan } from "./core/orbitPlan";
import { COUNTDOWN_S, FlightSim } from "./core/simulate";
import { ARTEMIS2, artemisAltitudeAt } from "./core/artemis2";
import {
  DEFAULT_STORM_ID,
  STORMS,
  STORMS_BY_ID,
  STORM_ONSET_S,
  radiationScale,
  stormLabel,
  stormOutcome,
  type StormResult,
} from "./core/spaceWeather";
import {
  isMuted,
  playAlert,
  playClick,
  playPartSnap,
  playRocketCheck,
  subscribeMute,
  toggleMute,
} from "./audio/soundManager";
import { TutorialOverlay } from "./components/TutorialOverlay";
import type { Quality, Telemetry, WarpControl, WeatherState } from "./scenes/FlightScene";

// The 3D scene and the planner are the heavy parts: load them as separate
// chunks so the interface shows up while three.js is still downloading.
const FlightScene = lazy(() => import("./scenes/FlightScene"));
const OrbitPlanner = lazy(() => import("./components/OrbitPlanner"));

/** Step 1 is assembly on the pad, step 2 plans the trip to the Moon, step 3 flies it, all in the same world. */
type Mode = "assembly" | "planning" | "flight";

const STEP_LABEL: Record<Mode, string> = {
  assembly: "Step 1 of 3 / Assembly",
  planning: "Step 2 of 3 / Orbit planning",
  flight: "Step 3 of 3 / Launch and flight",
};

const CATEGORY_LABEL: Record<string, string> = {
  crew: "Crew",
  propulsion: "Propulsion",
  lifeSupport: "Life support",
  power: "Power",
  protection: "Protection",
};

const WARP_LEVELS = [1, 2, 4, 10, 50, 100, 1000, 10000, 100000];

const fmt = new Intl.NumberFormat("en-US");

function formatClock(t: number) {
  const s = t - COUNTDOWN_S;
  const sign = s < 0 ? "T-" : "T+";
  const a = Math.abs(s);
  const d = Math.floor(a / 86400);
  const h = Math.floor((a % 86400) / 3600);
  const m = Math.floor((a % 3600) / 60);
  const sec = Math.floor(a % 60);
  const hms = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return d > 0 ? `${sign}${d}d ${hms}` : `${sign}${hms}`;
}

function formatDistance(m: number) {
  if (!isFinite(m)) return "escape";
  const km = m / 1000;
  if (Math.abs(km) >= 10000) return `${fmt.format(Math.round(km))} km`;
  if (Math.abs(km) >= 1) return `${km.toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

/** Mission time as "4d 22h" (or "5h 10m" under a day). */
function formatMissionTime(s: number) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${m}m`;
}

function formatSpeed(ms: number) {
  return Math.abs(ms) >= 1000 ? `${(ms / 1000).toFixed(2)} km/s` : `${Math.round(ms)} m/s`;
}

function formatTimeOfDay(hours: number) {
  const totalMinutes = Math.round((((hours % 24) + 24) % 24) * 60) % 1440;
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function advanceDateAndTime(baseDateStr: string, baseHours: number, elapsedSec: number) {
  const totalHours = baseHours + Math.max(0, elapsedSec) / 3600;
  const dayOffset = Math.floor(totalHours / 24);
  const displayTime = ((totalHours % 24) + 24) % 24;
  if (dayOffset === 0) return { displayDate: baseDateStr, displayTime };
  const parts = baseDateStr.split("-").map(Number);
  const utc = Date.UTC(parts[0] || 2026, (parts[1] || 7) - 1, (parts[2] || 20) + dayOffset);
  const d = new Date(utc);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return { displayDate: `${yyyy}-${mm}-${dd}`, displayTime };
}

export default function App() {
  const [mode, setMode] = useState<Mode>("assembly");
  const [parts, setParts] = useState<PartId[]>(["capsule", "serviceLarge", "lifeSupport7", "solarPanels"]);
  const [rocket, setRocket] = useState<RocketId>("heavy");
  const [plan, setPlan] = useState<OrbitPlan>(DEFAULT_PLAN);
  /** The plan the current flight is flying (null: the autopilot planned it). */
  const [flownPlan, setFlownPlan] = useState<OrbitPlan | null>(null);
  const [quality, setQuality] = useState<Quality>("low");
  const [weather, setWeather] = useState<WeatherState>("cloudy");
  const [tutorialOpen, setTutorialOpen] = useState(true);
  const [spaceAiOpen, setSpaceAiOpen] = useState(false);
  const [launchDate, setLaunchDate] = useState<string>("2026-07-20");
  const [timeOfDay, setTimeOfDay] = useState<number>(8.6);
  const [syncCycle, setSyncCycle] = useState<boolean>(true);
  const [mapView, setMapView] = useState(false);
  const [tel, setTel] = useState<Telemetry | null>(null);
  const [warpSetting, setWarpSetting] = useState<number | "auto">("auto");
  const [paused, setPaused] = useState(false);
  /** A real DONKI storm replayed during the flight, or "none" for a quiet Sun. */
  const [stormId, setStormId] = useState<string>(DEFAULT_STORM_ID);
  const [stormResult, setStormResult] = useState<StormResult | null>(null);
  const simRef = useRef<FlightSim>(new FlightSim(rocket, parts));
  const warp = useRef<WarpControl>({ setting: "auto", paused: false });
  const keys = useRef(new Set<string>());
  const [simVersion, setSimVersion] = useState(0);
  const [lookAt, setLookAt] = useState<{ body: "earth" | "moon"; n: number } | null>(null);
  const look = (body: "earth" | "moon") => setLookAt((l) => ({ body, n: (l?.n ?? 0) + 1 }));

  const t = useMemo(() => totals(parts), [parts]);
  const issues = useMemo(() => designIssues(parts), [parts]);
  const check = launchCheck(t.massKg, rocket);
  const totalCost = t.costMUsd + ROCKETS_BY_ID[rocket].costMUsd;
  const overBudget = totalCost > MISSION_REQUIREMENTS.budgetMUsd;
  const blockers = issues.filter((i) => i.severity === "blocker");
  const canLaunch = blockers.length === 0 && check.fits && !overBudget;
  const storm = STORMS_BY_ID[stormId] ?? null;
  const stormIsDangerous = !!storm && radiationScale(storm.protonFluxPfu) >= 2;

  // A fresh vehicle on the pad whenever the design changes before launch.
  useEffect(() => {
    if (mode === "flight") return;
    simRef.current = new FlightSim(rocket, parts);
    setSimVersion((v) => v + 1);
  }, [rocket, parts, mode]);

  useEffect(() => {
    warp.current.setting = warpSetting;
    warp.current.paused = paused;
  }, [warpSetting, paused]);

  const launch = (withPlan: OrbitPlan | null) => {
    setFlownPlan(withPlan);
    simRef.current = new FlightSim(rocket, parts, withPlan);
    setSimVersion((v) => v + 1);
    setWarpSetting("auto");
    setPaused(false);
    setMapView(false);
    setTel(null);
    setStormResult(null);
    setMode("flight");
  };
  const backTo = (m: Mode) => {
    setMode(m);
    setMapView(false);
    setTel(null);
    setStormResult(null);
  };

  // The storm reaches the spacecraft STORM_ONSET_S after liftoff, if the flight is still going.
  useEffect(() => {
    if (mode !== "flight" || !tel || !storm || stormResult) return;
    if (tel.failed || tel.done || tel.t - COUNTDOWN_S < STORM_ONSET_S) return;
    setStormResult(stormOutcome(storm, parts, tel.altitude));
    playAlert("solar_storm");
  }, [mode, tel, storm, stormResult, parts]);

  const stepWarp = useCallback(
    (dir: 1 | -1) => {
      setWarpSetting((w) => {
        const cur = w === "auto" ? (tel?.warp ?? 1) : w;
        let i = WARP_LEVELS.findIndex((l) => l >= cur);
        if (i < 0) i = WARP_LEVELS.length - 1;
        return WARP_LEVELS[Math.max(0, Math.min(WARP_LEVELS.length - 1, i + dir))];
      });
    },
    [tel?.warp],
  );

  // Keyboard: WASD steer, Shift/Ctrl throttle, Z full, X cut, T autopilot, M map, , . warp, P pause.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      keys.current.add(k);
      if (mode !== "flight") return;
      if (k === "m") setMapView((v) => !v);
      if (k === "t") simRef.current.setAutopilot(!simRef.current.autopilot);
      if (k === "." || k === ">") stepWarp(1);
      if (k === "," || k === "<") stepWarp(-1);
      if (k === "p") setPaused((p) => !p);
      if (["w", "a", "s", "d", "z", "x"].includes(k) && simRef.current.autopilot) {
        simRef.current.setAutopilot(false);
      }
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [mode, stepWarp]);

  const onTelemetry = useCallback((x: Telemetry) => setTel(x), []);

  // When syncCycle is enabled in flight, advance the displayed Date and Time-of-Day
  // automatically with mission time (sim.t - COUNTDOWN_S).
  const elapsedSimSec = mode === "flight" && syncCycle && tel ? Math.max(0, tel.t - COUNTDOWN_S) : 0;
  const { displayDate, displayTime } = advanceDateAndTime(launchDate, timeOfDay, elapsedSimSec);

  const handleDateChange = useCallback(
    (newDate: string) => {
      if (elapsedSimSec > 0) {
        const dayOffset = Math.floor((timeOfDay + elapsedSimSec / 3600) / 24);
        const parts = newDate.split("-").map(Number);
        const utc = Date.UTC(parts[0] || 2026, (parts[1] || 7) - 1, (parts[2] || 20) - dayOffset);
        const d = new Date(utc);
        const yyyy = d.getUTCFullYear();
        const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
        const dd = String(d.getUTCDate()).padStart(2, "0");
        setLaunchDate(`${yyyy}-${mm}-${dd}`);
      } else {
        setLaunchDate(newDate);
      }
    },
    [elapsedSimSec, timeOfDay],
  );

  const handleTimeChange = useCallback(
    (newTime: number) => {
      if (elapsedSimSec > 0) {
        const elapsedHours = (elapsedSimSec / 3600) % 24;
        setTimeOfDay(((newTime - elapsedHours) % 24 + 24) % 24);
      } else {
        setTimeOfDay(newTime);
      }
    },
    [elapsedSimSec],
  );

  return (
    <div className={`app mode-${mode}`}>
      <Suspense fallback={<div className="scene-loading">Loading 3D scene…</div>}>
        <FlightScene
          version={simVersion}
          simRef={simRef}
          rocket={rocket}
          parts={parts}
          flying={mode === "flight"}
          warp={warp}
          keys={keys}
          mapView={mapView}
          quality={quality}
          weather={weather}
          launchDate={launchDate}
          timeOfDay={timeOfDay}
          syncCycle={syncCycle}
          lookAt={lookAt}
          onTelemetry={onTelemetry}
        />
      </Suspense>

      <header className="topbar">
        <div className="brand">
          <span className="brand-name">Mission Architect</span>
          <span className="brand-sub">
            {STEP_LABEL[mode]} / {MISSION_REQUIREMENTS.name}
          </span>
        </div>
        <div className="steps">
          <span className={`step ${mode === "assembly" ? "on" : "done"}`}>1 Assembly</span>
          <span className={`step ${mode === "planning" ? "on" : mode === "flight" ? "done" : ""}`}>2 Orbit plan</span>
          <span className={`step ${mode === "flight" ? "on" : ""}`}>3 Launch and flight</span>
        </div>
      </header>

      {mode === "assembly" && (
        <>
          <aside className="panel left">
            <h2>Spacecraft</h2>
            <p className="hint">Pick the parts. Some can't be fitted together.</p>
            {Object.keys(CATEGORY_LABEL).map((cat) => (
              <div key={cat} className="group">
                <h3>{CATEGORY_LABEL[cat]}</h3>
                {PARTS.filter((p) => p.category === cat).map((p) => (
                  <label key={p.id} className={`part ${parts.includes(p.id) ? "on" : ""}`}>
                    <input type="checkbox" checked={parts.includes(p.id)} onChange={() => {
                        playPartSnap(!parts.includes(p.id));
                        setParts((s) => togglePart(s, p.id));
                      }} />
                    <span className="part-body">
                      <span className="part-name">{p.name}</span>
                      <span className="part-desc">{p.description}</span>
                      <span className="part-stats mono">
                        {fmt.format(p.massKg)} kg / {p.powerW > 0 ? "+" : ""}
                        {fmt.format(p.powerW)} W / ${p.costMUsd}M
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            ))}
            <h3>Rocket</h3>
            <div className="rockets">
              {ROCKETS.map((r) => {
                const fits = launchCheck(t.massKg, r.id).fits;
                return (
                  <button key={r.id} className={`rocket ${rocket === r.id ? "on" : ""}`} onClick={() => {
                      playRocketCheck(fits);
                      setRocket(r.id);
                    }}>
                    <span className="rocket-name">{r.name}</span>
                    <span className="mono small">{fmt.format(r.payloadToMoonKg)} kg</span>
                    <span className="mono small muted">${fmt.format(r.costMUsd)}M</span>
                    <span className={`small ${fits ? "ok" : "bad"}`}>{fits ? "Fits" : "Too heavy"}</span>
                  </button>
                );
              })}
            </div>
            <h3>Space weather</h3>
            <label className="storm-pick">
              <span className="part-desc">A real solar storm from NASA's DONKI database hits on day 2 of the flight.</span>
              <select value={stormId} onChange={(e) => setStormId(e.target.value)}>
                {STORMS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {stormLabel(s)}
                  </option>
                ))}
                <option value="none">Quiet Sun (no storm)</option>
              </select>
              {storm && (
                <span className="small">
                  <span className={stormIsDangerous && !parts.includes("radiationShield") ? "bad" : "muted"}>
                    {storm.title}.{" "}
                    {stormIsDangerous
                      ? parts.includes("radiationShield")
                        ? "Dangerous proton flux; the storm shelter will protect the crew."
                        : "Dangerous proton flux and no storm shelter on board."
                      : "Little or no proton radiation."}
                  </span>{" "}
                  <a href={storm.sourceUrl} target="_blank" rel="noreferrer">
                    DONKI record
                  </a>
                </span>
              )}
            </label>
          </aside>

          <aside className="panel right assembly">
            <h2>Readiness</h2>
            <Gauge
              label="Mass"
              value={`${fmt.format(t.massKg)} kg`}
              fill={check.usage}
              state={check.fits ? (check.usage > 0.92 ? "warn" : "ok") : "bad"}
              note={`${fmt.format(ROCKETS_BY_ID[rocket].payloadToMoonKg)} kg max on ${ROCKETS_BY_ID[rocket].name}`}
            />
            <Gauge
              label="Power"
              value={`${t.powerW >= 0 ? "+" : ""}${fmt.format(t.powerW)} W`}
              fill={t.powerW >= 0 ? 1 : 0.15}
              state={t.powerW >= 0 ? "ok" : "bad"}
              note={t.powerW >= 0 ? "Generation covers demand" : "Using more than it makes"}
            />
            <Gauge
              label="Budget"
              value={`$${fmt.format(totalCost)}M`}
              fill={totalCost / MISSION_REQUIREMENTS.budgetMUsd}
              state={overBudget ? "bad" : totalCost / MISSION_REQUIREMENTS.budgetMUsd > 0.9 ? "warn" : "ok"}
              note={`of $${fmt.format(MISSION_REQUIREMENTS.budgetMUsd)}M, rocket included`}
            />
            <Gauge
              label="Oxygen"
              value={`${t.oxygenDays} days`}
              fill={t.oxygenDays / (MISSION_REQUIREMENTS.durationDays * 1.5)}
              state={t.oxygenDays >= MISSION_REQUIREMENTS.durationDays ? "ok" : "bad"}
              note={`Mission needs ${MISSION_REQUIREMENTS.durationDays} days`}
            />
            <div className={`fits ${check.fits ? "ok" : "bad"}`}>
              Fits rocket? <strong>{check.fits ? "Yes" : "No"}</strong>
              <span className="mono small">
                {check.fits ? `${fmt.format(check.marginKg)} kg spare` : `${fmt.format(-check.marginKg)} kg over`}
              </span>
            </div>
            {(issues.length > 0 || overBudget) && (
              <ul className="issues">
                {overBudget && <li className="bad">Over budget by ${fmt.format(totalCost - MISSION_REQUIREMENTS.budgetMUsd)}M.</li>}
                {issues.map((i) => (
                  <li key={i.message} className={i.severity === "blocker" ? "bad" : "warn"}>
                    {i.message}
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <footer className="controls">
            <div className="buttons">
              <button className="primary big" disabled={!canLaunch} onClick={() => {
                playClick();
                setMode("planning");
              }}>
                Plan the orbit
              </button>
              <button disabled={!canLaunch} onClick={() => {
                playClick();
                launch(null);
              }} title="Skip planning: the autopilot picks the trajectory">
                Launch with autopilot plan
              </button>
              <span className="why small">
                {canLaunch
                  ? "Ready. Next, plan the trip to the Moon. Drag to look around the rocket, scroll to zoom."
                  : "Fix the red items on the right before you can launch."}
              </span>
              <EnvironmentControls
                launchDate={displayDate}
                onDateChange={handleDateChange}
                timeOfDay={displayTime}
                onTimeChange={handleTimeChange}
                syncCycle={syncCycle}
                onSyncChange={setSyncCycle}
                weather={weather}
                onWeatherChange={setWeather}
              />
              <AudioToggle />
              <QualityToggle quality={quality} onChange={setQuality} />
            </div>
          </footer>
        </>
      )}

      {mode === "planning" && (
        <>
          <Suspense fallback={<div className="scene-loading">Loading planner…</div>}>
            <OrbitPlanner rocket={rocket} parts={parts} plan={plan} onChange={setPlan} />
          </Suspense>
          <footer className="controls">
            <div className="buttons">
              <button onClick={() => {
                playClick();
                backTo("assembly");
              }}>Back to assembly</button>
              <button className="primary big" onClick={() => {
                playClick();
                launch(plan);
              }}>
                Launch this plan
              </button>
              <span className="why small">
                The autopilot flies the ascent and your burn. Small course corrections on the way are automatic.
              </span>
              <AudioToggle />
              <QualityToggle quality={quality} onChange={setQuality} />
            </div>
          </footer>
        </>
      )}

      {mode !== "planning" && (
        <TutorialOverlay
          persona={mode === "flight" ? "space" : "earth"}
          open={mode === "flight" ? spaceAiOpen : tutorialOpen}
          onOpenChange={mode === "flight" ? setSpaceAiOpen : setTutorialOpen}
          flightPhase={tel?.phase}
          altitudeM={tel?.altitude}
        />
      )}

      {mode === "flight" && tel && (
        <>
          <aside className="flight-hud">
            <div className="hud-row">
              <span className="label">Phase</span>
              <span className={`value ${tel.failed ? "bad" : tel.done ? "ok" : ""}`}>{tel.phase}</span>
              {tel.message && tel.message !== tel.phase && <span className="small muted">{tel.message}</span>}
            </div>
            <div className="hud-grid">
              <Stat label="Clock" value={formatClock(tel.t)} />
              <Stat label="Altitude" value={formatDistance(tel.altitude)} />
              <Stat label="Vertical" value={formatSpeed(tel.verticalSpeed)} />
              <Stat label="Orbital speed" value={formatSpeed(tel.orbitalSpeed)} />
              <Stat label="Apoapsis" value={tel.altitude > 0 && tel.apoapsis > -6e6 ? formatDistance(tel.apoapsis) : "-"} />
              <Stat label="Periapsis" value={tel.periapsis > -6e6 ? formatDistance(tel.periapsis) : "-"} />
              <Stat label="To the Moon" value={formatDistance(tel.moonDistance)} />
              <Stat label="Max g" value={tel.maxG.toFixed(1)} />
              <Stat label="Warp" value={tel.warp >= 1 ? `${fmt.format(Math.round(tel.warp))}x` : "paused"} />
            </div>
            <div className="hud-bars">
              <Bar label={`Fuel / ${tel.fuelName}`} fill={tel.fuel} />
              <Bar label="Throttle" fill={tel.throttle} />
            </div>
            {storm && !stormResult && !tel.done && !tel.failed && (
              <span className="small muted">
                Space weather: a real storm ({storm.startTimeUtc.slice(0, 10)}) arrives at T+2d.
              </span>
            )}
            {stormResult && (
              <div className={`storm-alert ${stormResult.severity}`}>
                <span className="storm-head">{stormResult.headline}</span>
                <span className="small">{stormResult.explanation}</span>
                <a className="small" href={stormResult.storm.sourceUrl} target="_blank" rel="noreferrer">
                  Open the DONKI record
                </a>
                {tel.done && stormResult.outcome === "exposed" && (
                  <span className="small bad">
                    The capsule is home, but the crew's radiation dose makes this a failed mission.
                  </span>
                )}
              </div>
            )}
            <ArtemisComparison tel={tel} />
            <span className={`small ${tel.autopilot ? "ok" : "warn"}`}>
              {tel.autopilot ? "Autopilot flying (press T or WASD to take over)" : "Manual control (press T for autopilot)"}
            </span>
            <span className="small muted">
              {flownPlan
                ? `Your plan: ${Math.round(flownPlan.parkingAltM / 1000)} km orbit, burn at ${flownPlan.phaseDeg.toFixed(1)}°, ${Math.round(flownPlan.tliDvMs)} m/s`
                : "Trajectory chosen by the autopilot"}
            </span>
          </aside>

          <footer className="controls">
            <div className="buttons">
              <button onClick={() => {
                playClick();
                setPaused((p) => !p);
              }}>{paused ? "Resume" : "Pause"}</button>
              <button onClick={() => {
                playClick();
                backTo("planning");
              }}>Edit plan</button>
              <div className="speed">
                <button className={warpSetting === "auto" ? "on" : ""} onClick={() => {
                playClick();
                setWarpSetting("auto");
              }}>
                  Auto
                </button>
                {WARP_LEVELS.map((w) => (
                  <button
                    key={w}
                    className={warpSetting === w ? "on" : ""}
                    disabled={w > tel.maxWarp}
                    onClick={() => {
                playClick();
                setWarpSetting(w);
              }}
                  >
                    {w >= 1000 ? `${w / 1000}k` : `${w}x`}
                  </button>
                ))}
              </div>
              <button className={mapView ? "on" : ""} onClick={() => {
                playClick();
                setMapView((m) => !m);
              }}>
                Map (M)
              </button>
              <button onClick={() => {
                playClick();
                look("earth");
              }}>Look at Earth</button>
              <button onClick={() => {
                playClick();
                look("moon");
              }}>Look at Moon</button>
              <EnvironmentControls
                launchDate={displayDate}
                onDateChange={handleDateChange}
                timeOfDay={displayTime}
                onTimeChange={handleTimeChange}
                syncCycle={syncCycle}
                onSyncChange={setSyncCycle}
                weather={weather}
                onWeatherChange={setWeather}
              />
              <AudioToggle />
              <QualityToggle quality={quality} onChange={setQuality} />
            </div>
            <span className="why small">
              WASD steer / Shift, Ctrl throttle / Z full, X cut / T autopilot / M map / , . warp / P pause. Drag to look
              around, scroll to zoom.
            </span>
          </footer>
        </>
      )}
    </div>
  );
}

/** The player's flight next to NASA's real Artemis II, on the same mission clock. */
function ArtemisComparison({ tel }: { tel: Telemetry }) {
  const missionT = tel.t - COUNTDOWN_S;
  const artemisAlt = artemisAltitudeAt(missionT);
  // The closest approach is known once the spacecraft has been moving away from the Moon for an hour.
  const flybyDone = isFinite(tel.closestMoon) && tel.t - tel.closestMoonT > 3600 && tel.moonDistance > tel.closestMoon;
  const km = (m: number) => `${fmt.format(Math.round(m / 1000))} km`;
  const rows: { label: string; you: string; artemis: string }[] = [
    {
      label: "Closest to the Moon",
      you: flybyDone ? `${km(tel.closestMoon)}, T+${formatMissionTime(tel.closestMoonT - COUNTDOWN_S)}` : "-",
      artemis: `${fmt.format(ARTEMIS2.closestMoonAltitudeKm)} km, T+${formatMissionTime(ARTEMIS2.closestMoonMissionTimeS)}`,
    },
    {
      label: "Farthest from Earth",
      you: flybyDone ? km(tel.maxAltitude) : "-",
      artemis: `${fmt.format(ARTEMIS2.maxEarthAltitudeKm)} km`,
    },
    {
      label: "Entry interface",
      you: isFinite(tel.entryT) ? `T+${formatMissionTime(tel.entryT - COUNTDOWN_S)}` : "-",
      artemis: `T+${formatMissionTime(ARTEMIS2.entryInterfaceMissionTimeS)}`,
    },
  ];
  return (
    <div className="artemis-compare">
      <span className="label">You vs NASA's Artemis II (real flight, April 2026)</span>
      {artemisAlt !== null && !tel.done && (
        <span className="small">
          At T+{formatMissionTime(missionT)} Artemis II was {km(artemisAlt)} from Earth; you are {km(tel.altitude)}.
        </span>
      )}
      <table className="small mono">
        <thead>
          <tr>
            <th />
            <th>You</th>
            <th>Artemis II</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td>{r.you}</td>
              <td>{r.artemis}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <span className="small muted">
        Orange line in the map (M): Artemis II's path, drawn round the game's Moon on your clock.{" "}
        <a href={ARTEMIS2.sourceUrl} target="_blank" rel="noreferrer">
          NASA ephemeris
        </a>
      </span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="label">{label}</span>
      <span className="value mono">{value}</span>
    </div>
  );
}

function Bar({ label, fill }: { label: string; fill: number }) {
  return (
    <div className="hud-bar">
      <span className="label">{label}</span>
      <div className="bar">
        <div className="bar-fill" style={{ width: `${Math.max(0, Math.min(1, fill)) * 100}%` }} />
      </div>
    </div>
  );
}

const WEATHER_OPTIONS: { id: WeatherState; label: string }[] = [
  { id: "clear", label: "Clear" },
  { id: "cloudy", label: "Cloudy" },
  { id: "rain", label: "Rain" },
  { id: "storm", label: "Storm" },
];

function EnvironmentControls({
  launchDate,
  onDateChange,
  timeOfDay,
  onTimeChange,
  syncCycle,
  onSyncChange,
  weather,
  onWeatherChange,
}: {
  launchDate: string;
  onDateChange: (d: string) => void;
  timeOfDay: number;
  onTimeChange: (t: number) => void;
  syncCycle: boolean;
  onSyncChange: (v: boolean) => void;
  weather: WeatherState;
  onWeatherChange: (w: WeatherState) => void;
}) {
  return (
    <div className="env-controls">
      <div className="env-weather" title="Launch site weather state (Storm enables volumetric cloud flashes & lightning bolts)">
        {WEATHER_OPTIONS.map((w) => (
          <button
            key={w.id}
            type="button"
            className={weather === w.id ? "on" : ""}
            onClick={() => onWeatherChange(w.id)}
          >
            {w.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className={`env-sync ${syncCycle ? "on" : ""}`}
        onClick={() => onSyncChange(!syncCycle)}
        title={
          syncCycle
            ? "Day/Night cycle advances with simulation speed (click to lock time of day)"
            : "Time of day locked (click to sync with simulation speed)"
        }
      >
        {syncCycle ? "Cycle" : "Locked"}
      </button>
      <label className="env-field" title="Calendar date (J2000 solar & lunar ephemeris)">
        <span className="label">Date</span>
        <input
          type="date"
          className="env-date mono"
          value={launchDate}
          onChange={(e) => e.target.value && onDateChange(e.target.value)}
        />
      </label>
      <label className="env-field env-time" title="Local time of day (moves sun, moon & clouds)">
        <span className="label">Time</span>
        <input
          type="range"
          min={0}
          max={24}
          step={0.01}
          value={timeOfDay}
          onChange={(e) => onTimeChange(parseFloat(e.target.value))}
        />
        <span className="mono small env-clock">{formatTimeOfDay(timeOfDay)}</span>
      </label>
    </div>
  );
}

function AudioToggle() {
  const [muted, setMutedState] = useState(() => isMuted());
  useEffect(() => subscribeMute(setMutedState), []);
  return (
    <div className="quality">
      <span className="label">Audio</span>
      <button className={!muted ? "on" : ""} onClick={() => toggleMute()}>
        {muted ? "Muted" : "On"}
      </button>
    </div>
  );
}

function QualityToggle({ quality, onChange }: { quality: Quality; onChange: (q: Quality) => void }) {
  return (
    <div className="quality">
      <span className="label">Quality</span>
      {(["high", "low"] as const).map((q) => (
        <button key={q} className={quality === q ? "on" : ""} onClick={() => onChange(q)}>
          {q === "high" ? "High" : "Low"}
        </button>
      ))}
    </div>
  );
}

function Gauge({
  label,
  value,
  fill,
  state,
  note,
}: {
  label: string;
  value: string;
  fill: number;
  state: "ok" | "warn" | "bad";
  note: string;
}) {
  return (
    <div className={`gauge ${state}`}>
      <div className="gauge-head">
        <span className="label">{label}</span>
        <span className="value mono">{value}</span>
      </div>
      <div className="bar">
        <div className="bar-fill" style={{ width: `${Math.min(Math.max(fill, 0), 1) * 100}%` }} />
      </div>
      <span className="note small">{note}</span>
    </div>
  );
}
