// The mission report shown when a flight ends: verdict, root cause, every finding
// with what to change, the key numbers and "What you learned" with NASA sources.
// All the logic is in src/core/missionReport.ts; this only lays it out.

import { useState } from "react";
import { explanationsFor } from "../core/explanations";
import type { Finding, MissionReport as Report } from "../core/missionReport";
import type { EducationalExplanation } from "../types/mission";

const VERDICT_LABEL: Record<Report["verdict"], string> = {
  success: "Mission success",
  partial: "Crew home, with problems",
  failure: "Mission failed",
};
const VERDICT_CLASS: Record<Report["verdict"], "ok" | "warn" | "bad"> = { success: "ok", partial: "warn", failure: "bad" };

const fmt = (n: number, digits = 0) =>
  isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits }) : "-";

interface Props {
  report: Report;
  onRedesign: () => void;
  onEditPlan: () => void;
  onFlyAgain: () => void;
}

export function MissionReport({ report, onRedesign, onEditPlan, onFlyAgain }: Props) {
  const [open, setOpen] = useState(true);
  const s = report.stats;
  const others = report.findings.filter((f) => f !== report.rootCause);

  if (!open)
    return (
      <button type="button" className="report-reopen primary" onClick={() => setOpen(true)}>
        Mission report
      </button>
    );

  return (
    <div className="report-backdrop" role="dialog" aria-modal="true" aria-labelledby="report-title">
      <section className="mission-report">
        <header className="report-head">
          <span className="label">Mission report</span>
          <h2 id="report-title" className={VERDICT_CLASS[report.verdict]}>
            {VERDICT_LABEL[report.verdict]}
          </h2>
          <p className="report-headline">{report.headline}</p>
          <button
            type="button"
            className="ghost report-close"
            aria-label="Close the report"
            title="Close and look at the scene"
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </header>

        <div className="report-stats">
          <Stat label="Mission time" value={`${fmt(s.missionDays, 1)} d`} />
          <Stat label="Closest to the Moon" value={isFinite(s.closestMoonKm) ? `${fmt(s.closestMoonKm)} km` : "-"} />
          <Stat label="Farthest from Earth" value={`${fmt(s.maxAltitudeKm)} km`} />
          <Stat label="Max g / re-entry g" value={`${fmt(s.maxG, 1)} / ${fmt(s.entryMaxG, 1)}`} />
          <Stat label="Life support left" value={`${fmt(s.lifeSupportLeftDays, 1)} of ${fmt(s.lifeSupportDays, 1)} d`} />
          <Stat label="Cost / budget" value={`$${fmt(s.costMUsd)}M / $${fmt(s.budgetMUsd)}M`} />
        </div>

        {report.rootCause && (
          <div className="report-block">
            <h3>Root cause</h3>
            <FindingItem f={report.rootCause} root />
          </div>
        )}

        {others.length > 0 && (
          <div className="report-block">
            <h3>{report.rootCause ? "Other findings" : "Findings"}</h3>
            <ul className="report-findings">
              {others.map((f, i) => (
                <li key={i}>
                  <FindingItem f={f} />
                </li>
              ))}
            </ul>
          </div>
        )}

        {report.learned.length > 0 && (
          <div className="report-block">
            <h3>What you learned</h3>
            <div className="report-learned">
              {report.learned.map((e) => (
                <Explanation key={e.id} e={e} />
              ))}
            </div>
          </div>
        )}

        <footer className="report-actions">
          <button type="button" className="primary" onClick={onRedesign}>
            Redesign the spacecraft
          </button>
          <button type="button" onClick={onEditPlan}>
            Change the orbit plan
          </button>
          <button type="button" className="ghost" onClick={onFlyAgain}>
            Fly again
          </button>
        </footer>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="report-stat">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
    </div>
  );
}

function FindingItem({ f, root = false }: { f: Finding; root?: boolean }) {
  const terms = f.severity === "ok" ? [] : explanationsFor(f.area).map((e) => e.term);
  return (
    <div className={`report-finding sev-${f.severity}${root ? " root" : ""}`}>
      <span className="finding-title">{f.title}</span>
      <span className="small">{f.detail}</span>
      {f.fix && <span className="small finding-fix">What to change: {f.fix}</span>}
      {terms.length > 0 && <span className="small muted">See below: {terms.join(", ")}</span>}
    </div>
  );
}

function Explanation({ e }: { e: EducationalExplanation }) {
  return (
    <article className="report-explanation">
      <span className="finding-title">{e.term}</span>
      <span className="small">{e.shortExplanation}</span>
      <span className="small finding-fix">Tip: {e.tradeOffTip}</span>
      <code className="report-formula">{e.formula}</code>
      <a className="small" href={e.sourceUrl} target="_blank" rel="noreferrer">
        Source: {e.sourceLabel}
      </a>
    </article>
  );
}
