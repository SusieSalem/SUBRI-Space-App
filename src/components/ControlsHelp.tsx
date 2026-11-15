import { Popover } from "./Popover";

const SHORTCUTS: [keys: string[], action: string][] = [
  [["W", "A", "S", "D"], "Steer"],
  [["Shift"], "Throttle up"],
  [["Ctrl"], "Throttle down"],
  [["Z"], "Full throttle"],
  [["X"], "Cut throttle"],
  [["T"], "Autopilot on / off"],
  [["M"], "Map view"],
  [[",", "."], "Slower / faster time"],
  [["P"], "Pause"],
  [["Drag"], "Look around"],
  [["Scroll"], "Zoom"],
];

/** ? button that lists the flight keyboard shortcuts. */
export function ControlsHelp() {
  return (
    <Popover label="Keyboard controls" trigger={<span className="icon-glyph">?</span>} panelClassName="help-panel">
      <span className="label">Keyboard controls</span>
      <dl className="shortcuts">
        {SHORTCUTS.map(([keys, action]) => (
          <div key={action}>
            <dt>
              {keys.map((k) => (
                <kbd key={k}>{k}</kbd>
              ))}
            </dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
    </Popover>
  );
}
