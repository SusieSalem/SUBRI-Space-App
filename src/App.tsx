import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MISSION_REQUIREMENTS,
  PARTS,
  designIssues,
  togglePart,
  totals,
  type PartId,
} from "./core/design";
import { ROCKETS, ROCKETS_BY_ID, launchCheck, type RocketId } from "./core/launchCheck";
import { COUNTDOWN_S, FlightSim } from "./core/simulate";
import FlightScene, { type Quality, type Telemetry, type WarpControl } from "./scenes/FlightScene";

/** Step 1 is assembly on the pad; step 2 is the flight, in the same world. */
type Mode = "assembly" | "flight";

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

function formatSpeed(ms: number) {
  return Math.abs(ms) >= 1000 ? `${(ms / 1000).toFixed(2)} km/s` : `${Math.round(ms)} m/s`;
}

export default function App() {
  const [mode, setMode] = useState<Mode>("assembly");
  const [parts, setParts] = useState<PartId[]>(["capsule", "serviceLarge", "lifeSupport7", "solarPanels"]);
  const [rocket, setRocket] = useState<RocketId>("heavy");
  const [quality, setQuality] = useState<Quality>("low");
  const [mapView, setMapView] = useState(false);
  const [tel, setTel] = useState<Telemetry | null>(null);
  const [warpSetting, setWarpSetting] = useState<number | "auto">("auto");
  const [paused, setPaused] = useState(false);
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

  // A fresh vehicle on the pad whenever the design changes during assembly.
  useEffect(() => {
    if (mode !== "assembly") return;
    simRef.current = new FlightSim(rocket, parts);
    setSimVersion((v) => v + 1);
  }, [rocket, parts, mode]);

  useEffect(() => {
    warp.current.setting = warpSetting;
    warp.current.paused = paused;
  }, [warpSetting, paused]);

  const launch = () => {
    simRef.current = new FlightSim(rocket, parts);
    setSimVersion((v) => v + 1);
    setWarpSetting("auto");
    setPaused(false);
    setMapView(false);
    setTel(null);
    setMode("flight");
  };
  const backToAssembly = () => {
    setMode("assembly");
    setMapView(false);
    setTel(null);
  };

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

  return (
    <div className={`app mode-${mode}`}>
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
        lookAt={lookAt}
        onTelemetry={onTelemetry}
      />

      <header className="topbar">
        <div className="brand">
          <span className="brand-name">Mission Architect</span>
          <span className="brand-sub">
            {mode === "assembly" ? "Step 1 of 2 / Assembly" : "Step 2 of 2 / Launch and flight"} /{" "}
            {MISSION_REQUIREMENTS.name}
          </span>
        </div>
        <div className="steps">
          <span className={`step ${mode === "assembly" ? "on" : "done"}`}>1 Assembly</span>
          <span className={`step ${mode === "flight" ? "on" : ""}`}>2 Launch and flight</span>
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
                    <input type="checkbox" checked={parts.includes(p.id)} onChange={() => setParts((s) => togglePart(s, p.id))} />
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
                  <button key={r.id} className={`rocket ${rocket === r.id ? "on" : ""}`} onClick={() => setRocket(r.id)}>
                    <span className="rocket-name">{r.name}</span>
                    <span className="mono small">{fmt.format(r.payloadToMoonKg)} kg</span>
                    <span className="mono small muted">${fmt.format(r.costMUsd)}M</span>
                    <span className={`small ${fits ? "ok" : "bad"}`}>{fits ? "Fits" : "Too heavy"}</span>
                  </button>
                );
              })}
            </div>
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
              <button className="primary big" disabled={!canLaunch} onClick={launch}>
                Launch
              </button>
              <span className="why small">
                {canLaunch
                  ? "Ready. The crew is boarding. Drag to look around the rocket, scroll to zoom."
                  : "Fix the red items on the right before you can launch."}
              </span>
              <QualityToggle quality={quality} onChange={setQuality} />
            </div>
          </footer>
        </>
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
            <span className={`small ${tel.autopilot ? "ok" : "warn"}`}>
              {tel.autopilot ? "Autopilot flying (press T or WASD to take over)" : "Manual control (press T for autopilot)"}
            </span>
          </aside>

          <footer className="controls">
            <div className="buttons">
              <button onClick={() => setPaused((p) => !p)}>{paused ? "Resume" : "Pause"}</button>
              <button onClick={backToAssembly}>Back to assembly</button>
              <div className="speed">
                <button className={warpSetting === "auto" ? "on" : ""} onClick={() => setWarpSetting("auto")}>
                  Auto
                </button>
                {WARP_LEVELS.map((w) => (
                  <button
                    key={w}
                    className={warpSetting === w ? "on" : ""}
                    disabled={w > tel.maxWarp}
                    onClick={() => setWarpSetting(w)}
                  >
                    {w >= 1000 ? `${w / 1000}k` : `${w}x`}
                  </button>
                ))}
              </div>
              <button className={mapView ? "on" : ""} onClick={() => setMapView((m) => !m)}>
                Map (M)
              </button>
              <button onClick={() => look("earth")}>Look at Earth</button>
              <button onClick={() => look("moon")}>Look at Moon</button>
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
