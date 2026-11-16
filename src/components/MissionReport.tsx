// The mission report shown when a flight ends: verdict, root cause, every finding
// with what to change, the key numbers and "What you learned" with NASA sources.
// All the logic is in src/core/missionReport.ts; this only lays it out.

import { useEffect, useState } from "react";
import { playAiVoice, stopAiVoice } from "../audio/soundManager";
import { explanationsFor } from "../core/explanations";
import type { Finding, MissionReport as Report } from "../core/missionReport";
import type { EducationalExplanation } from "../types/mission";

const VERDICT_LABEL: Record<Report["verdict"], string> = {
  success: "Mission success",
  partial: "Crew home, with problems",
  failure: "Mission failed",
};
const VERDICT_CLASS: Record<Report["verdict"], "ok" | "warn" | "bad"> = {
  success: "ok",
  partial: "warn",
  failure: "bad",
};

const fmt = (n: number, digits = 0) =>
  isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits }) : "-";

interface Props {
  report: Report;
  onRedesign: () => void;
  onEditPlan: () => void;
  onFlyAgain: () => void;
}

type ReportTab = "debrief" | "learned";

export function MissionReport({ report, onRedesign, onEditPlan, onFlyAgain }: Props) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<ReportTab>("debrief");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const s = report.stats;
  const others = report.findings.filter((f) => f !== report.rootCause);

  useEffect(() => {
    return () => stopAiVoice();
  }, []);

  const stopPlayback = () => {
    stopAiVoice();
    setPlayingId(null);
  };

  const toggleAudio = (id: string) => {
    if (playingId === id) {
      stopPlayback();
      return;
    }
    setPlayingId(id);
    playAiVoice(`/audio/voice/explanations/${id}.mp3`, () => {
      setPlayingId((cur) => (cur === id ? null : cur));
    });
  };

  if (!open)
    return (
      <button type="button" className="report-reopen primary" onClick={() => setOpen(true)}>
        Mission report
      </button>
    );

  return (
    <div className="report-backdrop" role="dialog" aria-modal="false" aria-labelledby="report-title">
      <section className="mission-report">
        <header className="report-head">
          <div className="report-head-top">
            <div>
              <span className="label">Flight debrief</span>
              <h2 id="report-title" className={VERDICT_CLASS[report.verdict]}>
                {VERDICT_LABEL[report.verdict]}
              </h2>
            </div>
            <button
              type="button"
              className="ghost report-close"
              aria-label="Close the report"
              title="Close and look at the scene"
              onClick={() => {
                stopPlayback();
                setOpen(false);
              }}
            >
              ×
            </button>
          </div>
          <p className="report-headline">{report.headline}</p>

          {report.learned.length > 0 && (
            <div className="report-tabs" role="tablist" aria-label="Mission report sections">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "debrief"}
                className={`report-tab ${tab === "debrief" ? "on" : ""}`}
                onClick={() => setTab("debrief")}
              >
                Summary
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "learned"}
                className={`report-tab ${tab === "learned" ? "on" : ""}`}
                onClick={() => setTab("learned")}
              >
                What you learned ({report.learned.length})
              </button>
            </div>
          )}
        </header>

        {tab === "debrief" ? (
          <>
            <div className="report-stats">
              <Stat label="Time" value={`${fmt(s.missionDays, 1)} d`} />
              <Stat label="Min Moon dist" value={isFinite(s.closestMoonKm) ? `${fmt(s.closestMoonKm)} km` : "-"} />
              <Stat label="Max altitude" value={`${fmt(s.maxAltitudeKm)} km`} />
              <Stat label="Peak / entry g" value={`${fmt(s.maxG, 1)} / ${fmt(s.entryMaxG, 1)}`} />
              <Stat label="Life support" value={`${fmt(s.lifeSupportLeftDays, 1)} / ${fmt(s.lifeSupportDays, 1)} d`} />
              <Stat label="Budget" value={`$${fmt(s.costMUsd)}M / $${fmt(s.budgetMUsd)}M`} />
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
          </>
        ) : (
          <div className="report-learned">
            {report.learned.map((e) => (
              <Explanation
                key={e.id}
                e={e}
                playing={playingId === e.id}
                onToggleAudio={() => toggleAudio(e.id)}
              />
            ))}
          </div>
        )}

        <footer className="report-actions">
          <button
            type="button"
            className="primary"
            onClick={() => {
              stopPlayback();
              onRedesign();
            }}
          >
            Redesign spacecraft
          </button>
          <button
            type="button"
            onClick={() => {
              stopPlayback();
              onEditPlan();
            }}
          >
            Edit orbit plan
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              stopPlayback();
              onFlyAgain();
            }}
          >
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
      <div className="report-finding-head">
        <span className={`finding-dot sev-${f.severity}`} aria-hidden="true" />
        <span className="finding-title">{f.title}</span>
      </div>
      <span className="small muted">{f.detail}</span>
      {f.fix && <span className="small finding-fix">{f.fix}</span>}
      {terms.length > 0 && <span className="small muted">Topics: {terms.join(", ")}</span>}
    </div>
  );
}

function Explanation({
  e,
  playing,
  onToggleAudio,
}: {
  e: EducationalExplanation;
  playing: boolean;
  onToggleAudio: () => void;
}) {
  return (
    <article className="report-explanation">
      <div className="explanation-head">
        <span className="finding-title">{e.term}</span>
        <button
          type="button"
          className={`explanation-listen ${playing ? "playing" : ""}`}
          onClick={onToggleAudio}
          aria-pressed={playing}
          title={playing ? "Stop voice explanation" : "Listen to voice explanation"}
        >
          {playing ? "Stop" : "Listen"}
        </button>
      </div>
      <span className="small muted">{e.shortExplanation}</span>
      <span className="small finding-fix">Tip: {e.tradeOffTip}</span>
      <div className="explanation-meta">
        <code className="report-formula">{e.formula}</code>
        <a className="small" href={e.sourceUrl} target="_blank" rel="noreferrer">
          {e.sourceLabel}
        </a>
      </div>
    </article>
  );
}
