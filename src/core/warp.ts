import type { FlightSim } from "./simulate";

/**
 * How fast mission time runs when the player leaves the warp on "auto" or "timelapse".
 * The physics steps are the same at any warp; this only changes how much of the flight
 * is played back per real second.
 *
 * auto:      the launch and entry are watchable, the long coasts fly by (about 5 minutes in all).
 * timelapse: the whole mission in about two minutes.
 */
export type WarpMode = "auto" | "timelapse";

export function autoWarp(sim: FlightSim, mode: WarpMode = "auto"): number {
  const fast = mode === "timelapse";
  const max = sim.maxWarp;
  const cap = (w: number) => Math.max(1, Math.min(max, w));
  switch (sim.phase) {
    case "prelaunch":
      return fast ? 2 : 1;
    case "ascent": {
      const alt = sim.altitude;
      if (fast) return cap(alt < 2000 ? 4 : 40);
      return cap(alt < 2000 ? 1 : alt < 20000 ? 4 : 20);
    }
    case "entry":
      return cap(fast ? 40 : 12);
    case "parachutes":
      return cap(fast ? 150 : 50);
  }
  // Engine burns (orbit insertion, TLI, corrections) at a fixed pace.
  if (sim.throttle > 0) return cap(fast ? 60 : 25);
  // Coasting: keep parking waits quick, then cruise cislunar legs over tens of seconds rather than 2-3s.
  const tn = sim.timeToNextEvent;
  if (!isFinite(tn)) return cap(fast ? 5000 : 1000);
  if (sim.phase === "parking") return cap(tn / (fast ? 2 : 5));
  const coastMax = fast ? 25000 : 10000;
  return cap(Math.min(coastMax, tn / (fast ? 6 : 16)));
}
