import { useCallback, useMemo, useRef, useState } from "react";
import {
  MISSION_REQUIREMENTS,
  PARTS,
  designIssues,
  togglePart,
  totals,
  type PartId,
} from "./core/design";
import { ROCKETS, ROCKETS_BY_ID, launchCheck, type RocketId } from "./core/launchCheck";
import SpaceScene, { type MissionClock } from "./scenes/SpaceScene";
import { MISSION_DURATION, PHASES, type MissionState } from "./scenes/mission";

const CATEGORY_LABEL: Record<string, string> = {
  crew: "Crew",
  propulsion: "Propulsion",
  lifeSupport: "Life support",
  power: "Power",
  protection: "Protection",
};

const fmt = new Intl.NumberFormat("en-US");

function formatMet(hours: number) {
  const d = Math.floor(hours / 24);
  const h = Math.floor(hours % 24);
  const m = Math.floor((hours * 60) % 60);
  return `${String(d).padStart(2, "0")}d ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`;
}

export default function App() {
  const [parts, setParts] = useState<PartId[]>(["capsule", "serviceLarge", "lifeSupport7", "solarPanels"]);
  const [rocket, setRocket] = useState<RocketId>("heavy");
  const [follow, setFollow] = useState(false);
  const [mission, setMission] = useState<MissionState | null>(null);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const clock = useRef<MissionClock>({ running: false, time: 0, speed: 1 });

  const t = useMemo(() => totals(parts), [parts]);
  const issues = useMemo(() => designIssues(parts), [parts]);
  const check = launchCheck(t.massKg, rocket);
  const totalCost = t.costMUsd + ROCKETS_BY_ID[rocket].costMUsd;
  const overBudget = totalCost > MISSION_REQUIREMENTS.budgetMUsd;
  const blockers = issues.filter((i) => i.severity === "blocker");
  const canLaunch = blockers.length === 0 && check.fits && !overBudget;

  const phase = mission?.phase ?? "idle";
  const inFlight = phase !== "idle" && phase !== "splashdown";
  const locked = clock.current.time > 0;

  const onState = useCallback((s: MissionState) => setMission(s), []);

  const launch = () => {
    clock.current.time = 0.0001;
    clock.current.running = true;
    setRunning(true);
    setFollow(true);
  };
  const togglePause = () => {
    clock.current.running = !clock.current.running;
    setRunning(clock.current.running);
  };
  const reset = () => {
    clock.current.time = 0;
    clock.current.running = false;
    setRunning(false);
    setFollow(false);
  };
  const changeSpeed = (s: number) => {
    clock.current.speed = s;
    setSpeed(s);
  };

  const phaseLabel =
    phase === "idle"
      ? "On the pad"
      : phase === "splashdown"
        ? "Splashdown. Crew home safe."
        : (PHASES.find((p) => p.id === phase)?.label ?? "");

  return (
    <div className="app">
      <SpaceScene parts={parts} clock={clock} follow={follow} onState={onState} />

      <header className="topbar">
        <div className="brand">
          <span className="brand-name">Mission Architect</span>
          <span className="brand-sub">Prototype / {MISSION_REQUIREMENTS.name}</span>
        </div>
        <div className="met">
          <span className="label">Mission elapsed time</span>
          <span className="value mono">{formatMet(mission?.realHours ?? 0)}</span>
        </div>
      </header>

      <aside className="panel left">
        <h2>Spacecraft</h2>
        <p className="hint">Pick the parts. Some can't be fitted together.</p>
        {Object.keys(CATEGORY_LABEL).map((cat) => (
          <div key={cat} className="group">
            <h3>{CATEGORY_LABEL[cat]}</h3>
            {PARTS.filter((p) => p.category === cat).map((p) => (
              <label key={p.id} className={`part ${parts.includes(p.id) ? "on" : ""} ${locked ? "locked" : ""}`}>
                <input
                  type="checkbox"
                  checked={parts.includes(p.id)}
                  disabled={locked}
                  onChange={() => setParts((s) => togglePart(s, p.id))}
                />
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
      </aside>

      <aside className="panel right">
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

        <h3>Rocket</h3>
        <div className="rockets">
          {ROCKETS.map((r) => {
            const fits = launchCheck(t.massKg, r.id).fits;
            return (
              <button
                key={r.id}
                className={`rocket ${rocket === r.id ? "on" : ""}`}
                disabled={locked}
                onClick={() => setRocket(r.id)}
              >
                <span className="rocket-name">{r.name}</span>
                <span className="mono small">{fmt.format(r.payloadToMoonKg)} kg</span>
                <span className={`small ${fits ? "ok" : "bad"}`}>{fits ? "Fits" : "Too heavy"}</span>
              </button>
            );
          })}
        </div>
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
        <div className="phase">
          <span className="label">Phase</span>
          <span className="value">{phaseLabel}</span>
          <div className="timeline">
            {PHASES.map((p, i) => (
              <span
                key={p.id}
                className={`seg ${mission && mission.phaseIndex > i ? "done" : ""} ${mission?.phaseIndex === i ? "now" : ""}`}
                style={{ flexGrow: p.duration / MISSION_DURATION }}
                title={p.label}
              >
                {mission?.phaseIndex === i && (
                  <span className="seg-fill" style={{ width: `${(mission.phaseProgress ?? 0) * 100}%` }} />
                )}
              </span>
            ))}
          </div>
        </div>
        <div className="buttons">
          {!inFlight && phase !== "splashdown" && (
            <button className="primary" disabled={!canLaunch} onClick={launch}>
              Launch
            </button>
          )}
          {inFlight && <button onClick={togglePause}>{running ? "Pause" : "Resume"}</button>}
          {(inFlight || phase === "splashdown") && <button onClick={reset}>Back to design</button>}
          <div className="speed">
            {[1, 3, 8].map((s) => (
              <button key={s} className={speed === s ? "on" : ""} onClick={() => changeSpeed(s)}>
                {s}x
              </button>
            ))}
          </div>
          <button className={follow ? "on" : ""} onClick={() => setFollow((f) => !f)}>
            {follow ? "Following spacecraft" : "Follow spacecraft"}
          </button>
        </div>
        {!canLaunch && !inFlight && phase !== "splashdown" && (
          <span className="why small">Fix the red items on the right to launch.</span>
        )}
      </footer>
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
