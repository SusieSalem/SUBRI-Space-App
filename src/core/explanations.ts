// Short educational explanations with their NASA sources (public/data/explanations.json),
// built by data-prep/build_all_data.py. The mission report uses them to explain each
// finding: which idea is behind it, a design tip, the formula and where to read more.
// Imported at build time so the core stays synchronous and works offline.

import raw from "../../public/data/explanations.json";
import type { EducationalExplanation } from "../types/mission";
import type { FindingArea } from "./missionReport";

export const EXPLANATIONS: EducationalExplanation[] = (raw as { explanations: EducationalExplanation[] }).explanations;

export const EXPLANATIONS_BY_ID: Record<string, EducationalExplanation> = Object.fromEntries(
  EXPLANATIONS.map((e) => [e.id, e]),
);

/** Which explanations go with each kind of finding in the mission report. */
const BY_AREA: Record<FindingArea, string[]> = {
  launch: ["launch_envelope", "staging"],
  trajectory: ["free_return"],
  propulsion: ["rocket_equation"],
  "life-support": ["life_support"],
  reentry: ["reentry"],
  radiation: ["space_weather", "radiation_shelter"],
  budget: [],
};

/** The explanations behind a finding of this area (empty for the budget). */
export function explanationsFor(area: FindingArea): EducationalExplanation[] {
  return BY_AREA[area].map((id) => EXPLANATIONS_BY_ID[id]).filter((e): e is EducationalExplanation => !!e);
}
