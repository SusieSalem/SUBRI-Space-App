import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { playClick } from "../audio/soundManager";

/**
 * A footer button that opens a glass panel upward.
 * Closes on Escape (focus returns to the button) and on any pointer press outside.
 */
export function Popover({
  label,
  trigger,
  panelClassName,
  children,
}: {
  /** Accessible name for both the button and the panel. */
  label: string;
  /** Visible content of the button (usually an icon). */
  trigger: ReactNode;
  panelClassName?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // The panel is right-aligned to its button; nudge it back on screen if it would spill over an edge.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    panel.style.translate = "";
    const margin = 16;
    const r = panel.getBoundingClientRect();
    const shift =
      r.left < margin ? margin - r.left : r.right > window.innerWidth - margin ? window.innerWidth - margin - r.right : 0;
    if (shift) panel.style.translate = `${shift}px 0`;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div className="popover-anchor" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`icon-btn ${open ? "on" : ""}`}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          playClick();
          setOpen((o) => !o);
        }}
      >
        {trigger}
      </button>
      {open && (
        <div ref={panelRef} id={panelId} role="dialog" aria-label={label} className={`popover ${panelClassName ?? ""}`}>
          {children}
        </div>
      )}
    </div>
  );
}
