// Runs the slow planner work (exact prediction with the real burn, plan search)
// off the main thread, so dragging the controls stays smooth.

import type { PartId } from "./design";
import type { RocketId } from "./launchCheck";
import { evaluatePlan, suggestPlan, type OrbitPlan } from "./orbitPlan";

export type PlanRequest =
  | { id: number; kind: "evaluate"; plan: OrbitPlan; rocket: RocketId; parts: PartId[] }
  | { id: number; kind: "suggest"; plan: OrbitPlan; rocket: RocketId; parts: PartId[] };

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<PlanRequest>) => void) | null;
  postMessage: (message: unknown) => void;
};

ctx.onmessage = (e) => {
  const req = e.data;
  if (req.kind === "evaluate") {
    ctx.postMessage({ id: req.id, kind: "evaluate", result: evaluatePlan(req.plan, req.rocket, req.parts) });
  } else {
    ctx.postMessage({ id: req.id, kind: "suggest", plan: suggestPlan(req.rocket, req.parts, req.plan.parkingAltM) });
  }
};
