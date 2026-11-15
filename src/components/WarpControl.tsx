import { ChevronLeftIcon, ChevronRightIcon } from "./icons";

function formatWarp(w: number) {
  if (w < 1) return "0x";
  return w >= 1000 ? `${w / 1000}k` : `${Math.round(w)}x`;
}

/**
 * Time warp in one capsule: [Auto | ‹ 4x ›].
 * In auto mode the number shows the warp the sim is using; stepping starts from there
 * (like the , . keys) and switches Auto off.
 */
export function WarpControl({
  levels,
  setting,
  effective,
  maxWarp,
  onAuto,
  onChange,
}: {
  levels: readonly number[];
  setting: number | "auto";
  /** Warp currently applied by the sim (telemetry). */
  effective: number;
  maxWarp: number;
  onAuto: () => void;
  onChange: (w: number) => void;
}) {
  const auto = setting === "auto";
  const cur = auto ? effective : setting;
  let i = levels.findIndex((l) => l >= cur);
  if (i < 0) i = levels.length - 1;
  const prev = i > 0 ? levels[i - 1] : undefined;
  const next = i < levels.length - 1 ? levels[i + 1] : undefined;
  const canFaster = next !== undefined && next <= maxWarp;

  return (
    <div className="warp" role="group" aria-label="Time warp">
      <button
        type="button"
        className={`warp-auto ${auto ? "on" : ""}`}
        aria-pressed={auto}
        title="Automatic time warp"
        onClick={onAuto}
      >
        Auto
      </button>
      <span className="warp-divider" aria-hidden="true" />
      <button
        type="button"
        aria-label="Slower"
        title="Slower (,)"
        disabled={prev === undefined}
        onClick={() => prev !== undefined && onChange(prev)}
      >
        <ChevronLeftIcon />
      </button>
      <output className="warp-value mono" aria-live={auto ? "off" : "polite"}>
        {formatWarp(cur)}
      </output>
      <button
        type="button"
        aria-label="Faster"
        title={canFaster ? "Faster (.)" : "Maximum warp for this phase"}
        disabled={!canFaster}
        onClick={() => canFaster && onChange(next)}
      >
        <ChevronRightIcon />
      </button>
    </div>
  );
}
