// Step 2: the orbit planner. The player sets the parking orbit, where to burn and
// how hard, and sees straight away where that takes the crew: a map of the trip in
// the Earth-Moon frame, a close-up of the departure with a draggable burn node, and
// three checks (reaches the Moon, enough propellant, comes home).
//
// While a control moves, a fast estimate (instant burn) is drawn on the main thread.
// When it settles, a web worker flies the real, minutes-long burn and replaces it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PartId } from "../core/design";
import type { RocketId } from "../core/launchCheck";
import { MOON_DISTANCE, R_EARTH, R_MOON } from "../core/orbit";
import {
  PARKING_ALT_RANGE,
  TLI_DV_RANGE,
  evaluatePlan,
  hohmannDv,
  type Check,
  type MapPoint,
  type OrbitPlan,
  type PlanResult,
} from "../core/orbitPlan";
import type { PlanRequest } from "../core/planWorker";

interface Props {
  rocket: RocketId;
  parts: PartId[];
  plan: OrbitPlan;
  onChange: (plan: OrbitPlan) => void;
}

const fmt = new Intl.NumberFormat("en-US");
const Mm = (m: number) => m / 1e6;
const wrap360 = (d: number) => ((d % 360) + 360) % 360;
const kmText = (m: number) => (isFinite(m) ? `${fmt.format(Math.round(m / 1000))} km` : "-");
const days = (h: number) => (isFinite(h) ? `day ${(h / 24).toFixed(1)}` : "-");

/* ----------------------------------------------------------- worker hook */

function usePlanWorker() {
  const worker = useRef<Worker | null>(null);
  const nextId = useRef(1);
  const pending = useRef(new Map<number, (data: unknown) => void>());

  useEffect(() => {
    const w = new Worker(new URL("../core/planWorker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<{ id: number }>) => {
      const done = pending.current.get(e.data.id);
      pending.current.delete(e.data.id);
      done?.(e.data);
    };
    worker.current = w;
    return () => {
      w.terminate();
      worker.current = null;
      pending.current.clear();
    };
  }, []);

  return useCallback(<T,>(req: Omit<PlanRequest, "id">): Promise<T> => {
    return new Promise((resolve) => {
      const id = nextId.current++;
      pending.current.set(id, (d) => resolve(d as T));
      worker.current?.postMessage({ ...req, id });
    });
  }, []);
}

/* ------------------------------------------------------------- planner */

export default function OrbitPlanner({ rocket, parts, plan, onChange }: Props) {
  const ask = usePlanWorker();

  // Fast estimate, every change.
  const estimate = useMemo(() => evaluatePlan(plan, rocket, parts, { coarse: true }), [plan, rocket, parts]);

  // Exact prediction, once the plan has settled for a moment.
  const [exact, setExact] = useState<{ key: string; result: PlanResult } | null>(null);
  const key = `${rocket}|${parts.join(",")}|${plan.parkingAltM}|${plan.phaseDeg}|${plan.tliDvMs}`;
  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      ask<{ result: PlanResult }>({ kind: "evaluate", plan, rocket, parts }).then((d) => {
        if (live) setExact({ key, result: d.result });
      });
    }, 180);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [ask, key, plan, rocket, parts]);

  const precise = exact?.key === key;
  const result = precise ? exact.result : estimate;

  const [searching, setSearching] = useState(false);
  const suggest = () => {
    setSearching(true);
    ask<{ plan: OrbitPlan }>({ kind: "suggest", plan, rocket, parts }).then((d) => {
      setSearching(false);
      onChange(d.plan);
    });
  };

  const set = useCallback((p: Partial<OrbitPlan>) => onChange({ ...plan, ...p }), [onChange, plan]);

  // Keyboard nudges, like a maneuver node: arrows move the burn, up/down change delta-v.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      const big = e.shiftKey ? 10 : 1;
      if (e.key === "ArrowLeft") set({ phaseDeg: wrap360(plan.phaseDeg + 0.5 * big) });
      else if (e.key === "ArrowRight") set({ phaseDeg: wrap360(plan.phaseDeg - 0.5 * big) });
      else if (e.key === "ArrowUp") set({ tliDvMs: clampDv(plan.tliDvMs + big) });
      else if (e.key === "ArrowDown") set({ tliDvMs: clampDv(plan.tliDvMs - big) });
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [plan, set]);

  const ideal = Math.round(hohmannDv(plan.parkingAltM));
  const po = result.parking;

  return (
    <div className="planner">
      <aside className="panel planner-controls">
        <h2>Maneuver</h2>
        <p className="hint">
          Pick a parking orbit, then where on it to fire the upper stage and how hard. The map shows where that sends
          the crew.
        </p>

        <AltitudeControl value={plan.parkingAltM} onCommit={(v) => set({ parkingAltM: v })} />

        <Control
          label="Burn point"
          value={`${plan.phaseDeg.toFixed(1)}°`}
          note="How far ahead the Moon is when you fire. Drag the node in the close-up."
          min={0}
          max={359.75}
          step={0.25}
          current={plan.phaseDeg}
          onInput={(v) => set({ phaseDeg: v })}
          nudges={[
            [-1, "−1°"],
            [-0.25, "−¼"],
            [0.25, "+¼"],
            [1, "+1°"],
          ]}
          onNudge={(d) => set({ phaseDeg: wrap360(plan.phaseDeg + d) })}
        />

        <Control
          label="Burn Δv"
          value={`${fmt.format(Math.round(plan.tliDvMs))} m/s`}
          note={`Prograde. An ideal transfer to the Moon's distance needs about ${fmt.format(ideal)} m/s.`}
          min={TLI_DV_RANGE.min}
          max={TLI_DV_RANGE.max}
          step={1}
          current={plan.tliDvMs}
          onInput={(v) => set({ tliDvMs: v })}
          nudges={[
            [-10, "−10"],
            [-1, "−1"],
            [1, "+1"],
            [10, "+10"],
          ]}
          onNudge={(d) => set({ tliDvMs: clampDv(plan.tliDvMs + d) })}
        />

        <button className="suggest" onClick={suggest} disabled={searching || !po.state}>
          {searching ? "Searching for a free return…" : "Suggest a plan"}
        </button>
        <span className="why small">Arrow keys: ← → move the burn, ↑ ↓ change Δv (Shift for bigger steps).</span>
      </aside>

      <section className="planner-map glass-card">
        <div className="map-header">
          <span className="label">Trajectory · Earth–Moon view</span>
          <span className={`precision small ${precise ? "ok" : "muted"}`}>
            {precise ? "Real burn simulated" : "Estimating…"}
          </span>
        </div>
        <TripMap result={result} />
        <DepartureView result={result} plan={plan} onPhase={(d) => set({ phaseDeg: d })} />
        <Legend corrected={showFlown(result)} />
      </section>

      <aside className="panel planner-checks">
        <h2>Flight check</h2>
        <CheckRow index={1} check={result.checks.moon} />
        <CheckRow index={2} check={result.checks.fuel} />
        <CheckRow index={3} check={result.checks.home} />

        {po.state && (
          <>
            <DvBudget used={plan.tliDvMs} available={po.available} />
            <dl className="plan-facts">
              <Fact
                label="Parking orbit"
                value={`${fmt.format(Math.round(po.periapsisAlt / 1000))} × ${kmText(po.apoapsisAlt)}`}
              />
              <Fact label="Wait in orbit" value={`${Math.round(result.waitMin)} min`} />
              <Fact label="Highest point" value={isFinite(result.apoapsisAlt) ? kmText(result.apoapsisAlt) : "escape"} />
              <Fact
                label="Closest to the Moon"
                value={
                  result.hitsMoon
                    ? "impact"
                    : result.checks.moon.state === "bad"
                      ? "-"
                      : `${kmText(result.periluneAlt)} · ${days(result.periluneHours)}`
                }
              />
              {result.flown ? (
                <>
                  <Fact
                    label="Course corrections"
                    value={`${fmt.format(Math.round(result.flown.correctionDv * 10) / 10)} m/s`}
                  />
                  <Fact
                    label="Back at the Earth"
                    value={result.flown.outcome === "splashdown" ? days(result.flown.days * 24) : "never"}
                  />
                </>
              ) : (
                <Fact label="Back at the Earth" value={days(result.returnHours)} />
              )}
            </dl>
          </>
        )}
      </aside>
    </div>
  );
}

const clampDv = (v: number) => Math.min(TLI_DV_RANGE.max, Math.max(TLI_DV_RANGE.min, Math.round(v)));

/* ------------------------------------------------------------ controls */

function Control(props: {
  label: string;
  value: string;
  note: string;
  min: number;
  max: number;
  step: number;
  current: number;
  onInput: (v: number) => void;
  nudges: [number, string][];
  onNudge: (d: number) => void;
}) {
  return (
    <div className="ctl">
      <div className="ctl-head">
        <span className="label">{props.label}</span>
        <span className="ctl-value mono">{props.value}</span>
      </div>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.current}
        onChange={(e) => props.onInput(Number(e.target.value))}
      />
      <div className="ctl-nudges">
        {props.nudges.map(([d, text]) => (
          <button key={text} onClick={() => props.onNudge(d)}>
            {text}
          </button>
        ))}
      </div>
      <span className="note small">{props.note}</span>
    </div>
  );
}

/** The ascent is re-simulated for each height, so the value is committed when the slider is let go. */
function AltitudeControl({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft !== value && onCommit(draft);
  return (
    <div className="ctl">
      <div className="ctl-head">
        <span className="label">Parking orbit</span>
        <span className="ctl-value mono">{fmt.format(Math.round(draft / 1000))} km</span>
      </div>
      <input
        type="range"
        min={PARKING_ALT_RANGE.min}
        max={PARKING_ALT_RANGE.max}
        step={PARKING_ALT_RANGE.step}
        value={draft}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <span className="note small">Lower costs less to reach; higher drags less. The autopilot flies the ascent.</span>
    </div>
  );
}

function CheckRow({ index, check }: { index: number; check: Check }) {
  return (
    <div className={`check ${check.state}`}>
      <span className="check-dot" aria-hidden>
        {check.state === "ok" ? "✓" : check.state === "warn" ? "!" : "✕"}
      </span>
      <div>
        <span className="check-title">
          <span className="muted mono">{index} </span>
          {check.title}
        </span>
        <span className="check-detail small">{check.detail}</span>
      </div>
    </div>
  );
}

function DvBudget({ used, available }: { used: number; available: number }) {
  const frac = available > 0 ? used / available : 1;
  const state = frac > 1 ? "bad" : frac > 0.97 ? "warn" : "ok";
  return (
    <div className={`gauge ${state}`}>
      <div className="gauge-head">
        <span className="label">Δv budget</span>
        <span className="value mono">
          {fmt.format(Math.round(used))} / {fmt.format(Math.round(available))} m/s
        </span>
      </div>
      <div className="bar">
        <div className="bar-fill" style={{ width: `${Math.min(1, Math.max(0, frac)) * 100}%` }} />
      </div>
      <span className="note small">Upper stage, then the service module (150 m/s kept for corrections).</span>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="label">{label}</dt>
      <dd className="mono">{value}</dd>
    </>
  );
}

/** The corrected path is only worth drawing when the corrections bend it visibly. */
const showFlown = (r: PlanResult) => !!r.flown && r.flown.path.length > 1 && r.flown.correctionDv >= 1;

function Legend({ corrected }: { corrected: boolean }) {
  return (
    <div className="map-legend small">
      <span>
        <i className="sw out" /> To the Moon
      </span>
      <span>
        <i className="sw back" /> {corrected ? "Without corrections" : "Way home"}
      </span>
      {corrected && (
        <span>
          <i className="sw flown" /> With corrections
        </span>
      )}
      <span>
        <i className="sw node" /> Burn
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- maps */

const toPath = (pts: MapPoint[]) =>
  pts.length ? "M" + pts.map((p) => `${Mm(p.x).toFixed(2)} ${(-Mm(p.y)).toFixed(2)}`).join("L") : "";

/** The whole trip, with the Moon held still on the right (rotating Earth-Moon frame). */
function TripMap({ result }: { result: PlanResult }) {
  const D = Mm(MOON_DISTANCE);
  const view = useMemo(() => {
    let minX = -40;
    let maxX = D + 70;
    let minY = -110;
    let maxY = 110;
    for (const p of [...result.outbound, ...result.inbound, ...(result.flown?.path ?? [])]) {
      const x = Mm(p.x);
      const y = -Mm(p.y);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    // Keep runaway paths from shrinking the Earth and Moon to nothing.
    minX = Math.max(minX, -D * 0.9);
    maxX = Math.min(maxX, D * 1.9);
    // Symmetric about the Earth-Moon line, so the Earth sits mid-height, clear of the close-up.
    const halfY = Math.min(D, Math.max(-minY, maxY));
    minY = -halfY;
    maxY = halfY;
    const pad = (maxX - minX) * 0.05;
    return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
  }, [result, D]);

  // About one screen pixel in map units (the card is roughly 950 x 650 px).
  const u = Math.max(view.w / 950, view.h / 650);
  const dayTicks = useMemo(() => {
    const ticks: { x: number; y: number; d: number }[] = [];
    let next = 24;
    for (const p of [...result.outbound, ...result.inbound]) {
      if (p.h >= next) {
        ticks.push({ x: Mm(p.x), y: -Mm(p.y), d: Math.round(next / 24) });
        next += 24;
      }
    }
    return ticks;
  }, [result]);

  const pl = result.perilunePoint;
  return (
    <svg className="trip-map" viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id="pm-earth" cx="35%" cy="32%" r="68%">
          <stop offset="0%" stopColor="#5aa2e6" />
          <stop offset="65%" stopColor="#14427a" />
          <stop offset="100%" stopColor="#061830" />
        </radialGradient>
        <radialGradient id="pm-moon" cx="32%" cy="30%" r="72%">
          <stop offset="0%" stopColor="#e2e2e8" />
          <stop offset="70%" stopColor="#6a6a74" />
          <stop offset="100%" stopColor="#24242c" />
        </radialGradient>
      </defs>

      {/* Distance rings every 100,000 km and the Moon's orbit */}
      {[100, 200, 300].map((r) => (
        <circle key={r} cx={0} cy={0} r={r} className="ring" vectorEffect="non-scaling-stroke" />
      ))}
      <circle cx={0} cy={0} r={D} className="ring moon-orbit" vectorEffect="non-scaling-stroke" />
      {[100, 200, 300].map((r) => (
        <text key={r} x={r + 3 * u} y={-4 * u} className="ring-label" fontSize={10 * u}>
          {fmt.format(r * 1000)} km
        </text>
      ))}

      {/* Moon's sphere of influence */}
      <circle cx={D} cy={0} r={66.1} className="soi" vectorEffect="non-scaling-stroke" />

      <path d={toPath(result.outbound)} className="trip out" vectorEffect="non-scaling-stroke" />
      <path
        d={toPath(result.inbound)}
        className={`trip back${showFlown(result) ? " faded" : ""}`}
        vectorEffect="non-scaling-stroke"
      />
      {/* What the flight will really do: the autopilot's course corrections bend the way home. */}
      {showFlown(result) && (
        <path d={toPath(result.flown!.path)} className="trip flown" vectorEffect="non-scaling-stroke" />
      )}

      {dayTicks.map((t) => (
        <g key={t.d}>
          <circle cx={t.x} cy={t.y} r={2.2 * u} className="tick" />
          <text x={t.x + 5 * u} y={t.y - 5 * u} className="tick-label" fontSize={9.5 * u}>
            D{t.d}
          </text>
        </g>
      ))}

      <circle cx={0} cy={0} r={Math.max(Mm(R_EARTH), 7 * u)} fill="url(#pm-earth)" />
      <text x={0} y={18 * u} className="body-label" fontSize={11 * u} textAnchor="middle">
        Earth
      </text>
      <circle cx={D} cy={0} r={Math.max(Mm(R_MOON), 5 * u)} fill="url(#pm-moon)" />
      <text x={D} y={18 * u} className="body-label" fontSize={11 * u} textAnchor="middle">
        Moon
      </text>

      {pl && !result.hitsMoon && result.checks.moon.state !== "bad" && (
        <g>
          <circle cx={Mm(pl.x)} cy={-Mm(pl.y)} r={3.5 * u} className="perilune" />
          <text x={Mm(pl.x) + 7 * u} y={-Mm(pl.y) - 7 * u} className="callout" fontSize={10.5 * u}>
            {kmText(result.periluneAlt)}
          </text>
        </g>
      )}
      {result.hitsMoon && pl && (
        <text x={Mm(pl.x) + 7 * u} y={-Mm(pl.y) - 7 * u} className="callout bad" fontSize={11 * u}>
          Impact
        </text>
      )}
      {!result.parking.state && (
        <text x={D / 2} y={0} className="callout bad" fontSize={14 * u} textAnchor="middle">
          This rocket can't reach the parking orbit
        </text>
      )}
    </svg>
  );
}

/** Close-up of the Earth and the parking orbit, with the burn node to drag round it. */
function DepartureView({
  result,
  plan,
  onPhase,
}: {
  result: PlanResult;
  plan: OrbitPlan;
  onPhase: (deg: number) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState(false);
  const R = 22; // Mm shown each side of the Earth
  const rPark = Mm(R_EARTH + plan.parkingAltM);
  const a = (plan.phaseDeg * Math.PI) / 180;
  const node = { x: rPark * Math.cos(a), y: -rPark * Math.sin(a) };
  // Prograde: the spacecraft goes round clockwise in this frame (angle decreasing).
  const pro = { x: Math.sin(a), y: Math.cos(a) };
  const arrow = 4 + ((plan.tliDvMs - TLI_DV_RANGE.min) / (TLI_DV_RANGE.max - TLI_DV_RANGE.min)) * 6;

  const near = useMemo(
    () => result.outbound.filter((p) => Math.hypot(p.x, p.y) < (R + 6) * 1e6),
    [result.outbound],
  );

  const angleFromEvent = (e: React.PointerEvent) => {
    const el = svg.current;
    const m = el?.getScreenCTM();
    if (!el || !m) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return wrap360((Math.atan2(-pt.y, pt.x) * 180) / Math.PI);
  };
  const move = (e: React.PointerEvent) => {
    if (!dragging) return;
    const d = angleFromEvent(e);
    if (d !== null) onPhase(Math.round(d * 4) / 4);
  };

  return (
    <div className="departure">
      <span className="label">Departure close-up</span>
      <svg
        ref={svg}
        viewBox={`${-R} ${-R} ${2 * R} ${2 * R}`}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          setDragging(true);
          const d = angleFromEvent(e);
          if (d !== null) onPhase(Math.round(d * 4) / 4);
        }}
        onPointerMove={move}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
      >
        <defs>
          <radialGradient id="dv-earth" cx="35%" cy="32%" r="68%">
            <stop offset="0%" stopColor="#5aa2e6" />
            <stop offset="65%" stopColor="#14427a" />
            <stop offset="100%" stopColor="#061830" />
          </radialGradient>
          <marker id="dv-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0 0 L10 5 L0 10 z" className="arrow-head" />
          </marker>
        </defs>
        {/* Direction of the Moon */}
        <line x1={0} y1={0} x2={R} y2={0} className="moon-dir" vectorEffect="non-scaling-stroke" />
        <text x={R - 1} y={-1.2} className="moon-dir-label" fontSize={1.7} textAnchor="end">
          to the Moon →
        </text>
        <circle cx={0} cy={0} r={rPark} className="park" vectorEffect="non-scaling-stroke" />
        <circle cx={0} cy={0} r={Mm(R_EARTH)} fill="url(#dv-earth)" />
        <path d={toPath(near)} className="trip out" vectorEffect="non-scaling-stroke" />
        {/* Phase angle arc from the burn to the Moon direction */}
        <path
          d={`M ${node.x * 1.35} ${node.y * 1.35} A ${rPark * 1.35} ${rPark * 1.35} 0 ${plan.phaseDeg > 180 ? 1 : 0} 1 ${rPark * 1.35} 0`}
          className="phase-arc"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={node.x}
          y1={node.y}
          x2={node.x + pro.x * arrow}
          y2={node.y + pro.y * arrow}
          className="prograde"
          markerEnd="url(#dv-arrow)"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={node.x} cy={node.y} r={1.1} className={`node ${dragging ? "on" : ""}`} />
      </svg>
      <span className="small muted">Drag the node round the orbit</span>
    </div>
  );
}
