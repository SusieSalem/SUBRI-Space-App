import { MISSION_REQUIREMENTS, PARTS_BY_ID, type PartId } from "../core/design";
import { ROCKETS_BY_ID, launchCheck, type RocketId } from "../core/launchCheck";
import { PartPreview, type PreviewKind } from "./PartPreview";

const fmt = new Intl.NumberFormat("en-US");

const CATEGORY_LABEL: Record<string, string> = {
  crew: "Crew Module",
  propulsion: "Propulsion",
  lifeSupport: "Life Support",
  power: "Power",
  protection: "Protection",
};

const isRocket = (k: PreviewKind): k is RocketId => k === "light" || k === "medium" || k === "heavy";

export function PartInspector({
  kind,
  top,
  selectedParts,
  selectedRocket,
  spacecraftMassKg,
}: {
  kind: PreviewKind;
  top: number;
  selectedParts: PartId[];
  selectedRocket: RocketId;
  spacecraftMassKg: number;
}) {
  if (isRocket(kind)) {
    const r = ROCKETS_BY_ID[kind];
    const check = launchCheck(spacecraftMassKg, kind);
    const active = selectedRocket === kind;
    const pct = Math.round(check.usage * 100);
    return (
      <aside className="part-inspector" style={{ top }} aria-live="polite">
        <div className="pi-head">
          <PartPreview kind={kind} hovered className="pi-preview" />
          <div className="pi-title-wrap">
            <span className="pi-eyebrow">Launch Vehicle · {r.realAnalog}</span>
            <h4 className="pi-title">{r.fullName}</h4>
            <span className={`pi-badge ${active ? "on" : ""}`}>{active ? "Selected rocket" : "Click to select"}</span>
          </div>
        </div>

        <div className="pi-stats">
          <div className="pi-stat">
            <span className="pi-label">Lunar payload</span>
            <span className="pi-val mono">{fmt.format(r.payloadToMoonKg)} kg</span>
          </div>
          <div className="pi-stat">
            <span className="pi-label">Launch cost</span>
            <span className="pi-val mono">${fmt.format(r.costMUsd)}M</span>
          </div>
          <div className="pi-stat">
            <span className="pi-label">Your load</span>
            <span className={`pi-val mono ${check.fits ? "ok" : "bad"}`}>{pct}% used</span>
          </div>
          <div className="pi-stat">
            <span className="pi-label">Payload margin</span>
            <span className={`pi-val mono ${check.fits ? "ok" : "bad"}`}>
              {check.marginKg >= 0 ? "+" : ""}
              {fmt.format(check.marginKg)} kg
            </span>
          </div>
        </div>

        <div className="pi-bar" aria-hidden="true">
          <div
            className={`pi-bar-fill ${check.fits ? (check.usage > 0.92 ? "warn" : "ok") : "bad"}`}
            style={{ width: `${Math.min(100, Math.max(0, check.usage * 100))}%` }}
          />
        </div>

        {r.payloadNote && <p className="pi-notes">{r.payloadNote}</p>}
        <p className="pi-source">Source: {r.sourceLabel}</p>
      </aside>
    );
  }

  const p = PARTS_BY_ID[kind];
  const active = selectedParts.includes(kind);
  const rocketCap = ROCKETS_BY_ID[selectedRocket].payloadToMoonKg;
  const massShare = Math.round((p.massKg / rocketCap) * 100);
  const replaces = p.excludes?.map((id) => PARTS_BY_ID[id].name).join(", ");

  return (
    <aside className="part-inspector" style={{ top }} aria-live="polite">
      <div className="pi-head">
        <PartPreview kind={kind} hovered className="pi-preview" />
        <div className="pi-title-wrap">
          <span className="pi-eyebrow">{CATEGORY_LABEL[p.category] ?? p.category}</span>
          <h4 className="pi-title">{p.name}</h4>
          <span className={`pi-badge ${active ? "on" : ""}`}>{active ? "Fitted on craft" : "Not fitted"}</span>
        </div>
      </div>

      <div className="pi-stats">
        <div className="pi-stat">
          <span className="pi-label">Mass ({massShare}% of cap)</span>
          <span className="pi-val mono">{fmt.format(p.massKg)} kg</span>
        </div>
        <div className="pi-stat">
          <span className="pi-label">Power</span>
          <span className={`pi-val mono ${p.powerW >= 0 ? "ok" : "warn"}`}>
            {p.powerW > 0 ? "+" : ""}
            {fmt.format(p.powerW)} W
          </span>
        </div>
        <div className="pi-stat">
          <span className="pi-label">Unit cost</span>
          <span className="pi-val mono">${fmt.format(p.costMUsd)}M</span>
          <span className="pi-sub">of ${fmt.format(MISSION_REQUIREMENTS.budgetMUsd)}M budget</span>
        </div>
        {p.propellantKg !== undefined && (
          <div className="pi-stat">
            <span className="pi-label">Propellant</span>
            <span className="pi-val mono ok">{fmt.format(p.propellantKg)} kg</span>
          </div>
        )}
        {p.oxygenDays > 0 && (
          <div className="pi-stat">
            <span className="pi-label">Life support</span>
            <span className="pi-val mono ok">+{p.oxygenDays} days</span>
          </div>
        )}
      </div>

      <p className="pi-desc">{p.description}</p>
      <p className="pi-notes">{p.notes}</p>
      {replaces && <p className="pi-compat">Cannot be fitted with: {replaces}</p>}
      <p className="pi-source">Source: {p.sourceLabel}</p>
    </aside>
  );
}
