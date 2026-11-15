// Spacecraft parts and the totals they add up to.
// Masses, power, cost and oxygen come from public/data/crewed_lunar.json
// (NASA Orion / ESA ESM reference figures); each part keeps its source.

import { CREWED, crewedPart } from "./crewedData";

export type PartId =
  | "capsule"
  | "serviceSmall"
  | "serviceLarge"
  | "lifeSupport7"
  | "lifeSupport14"
  | "solarPanels"
  | "radiationShield";

export type PartCategory = "crew" | "propulsion" | "lifeSupport" | "power" | "protection";

export interface Part {
  id: PartId;
  name: string;
  category: PartCategory;
  description: string;
  massKg: number;
  /** Positive generates power, negative uses it. */
  powerW: number;
  costMUsd: number;
  oxygenDays: number;
  /** Propellant included in massKg (service modules). */
  propellantKg?: number;
  notes: string;
  sourceLabel: string;
  sourceUrl: string;
  /** Parts that can't be fitted together with this one. */
  excludes?: PartId[];
}

/** Short in-game descriptions. Every number comes from the dataset. */
const DESCRIPTIONS: Record<PartId, string> = {
  capsule: "Pressurised cabin for 4 crew, heat shield for re-entry.",
  serviceSmall: "Main engine and fuel for a short trip.",
  serviceLarge: "More fuel: enough to brake into lunar orbit and come back.",
  lifeSupport7: "Oxygen, water and CO2 scrubbing for a week.",
  lifeSupport14: "Two weeks of consumables. Heavier, but leaves a margin.",
  solarPanels: "Four deployable wings. Without them the batteries run flat.",
  radiationShield: "Storm shelter for the crew during solar particle events.",
};

const EXCLUDES: Partial<Record<PartId, PartId[]>> = {
  serviceSmall: ["serviceLarge"],
  serviceLarge: ["serviceSmall"],
  lifeSupport7: ["lifeSupport14"],
  lifeSupport14: ["lifeSupport7"],
};

const PART_ORDER: PartId[] = [
  "capsule",
  "serviceSmall",
  "serviceLarge",
  "lifeSupport7",
  "lifeSupport14",
  "solarPanels",
  "radiationShield",
];

export const PARTS: Part[] = PART_ORDER.map((id) => {
  const d = crewedPart(id);
  return {
    id,
    name: d.name,
    category: d.category,
    description: DESCRIPTIONS[id],
    massKg: d.massKg,
    powerW: d.powerW,
    costMUsd: d.costMUsd,
    oxygenDays: d.oxygenDays,
    propellantKg: d.propellantKg,
    notes: d.notes,
    sourceLabel: d.sourceLabel,
    sourceUrl: d.sourceUrl,
    excludes: EXCLUDES[id],
  };
});

export const PARTS_BY_ID: Record<PartId, Part> = Object.fromEntries(
  PARTS.map((p) => [p.id, p]),
) as Record<PartId, Part>;

/** What the mission asks for, from the dataset. */
export const MISSION_REQUIREMENTS = {
  name: CREWED.missionRequirements.name,
  durationDays: CREWED.missionRequirements.durationDays,
  budgetMUsd: CREWED.missionRequirements.budgetMUsd,
  crewCount: CREWED.missionRequirements.crewCount,
};

export interface DesignTotals {
  massKg: number;
  powerW: number;
  costMUsd: number;
  oxygenDays: number;
}

export function totals(selected: PartId[]): DesignTotals {
  return selected.reduce<DesignTotals>(
    (acc, id) => {
      const p = PARTS_BY_ID[id];
      acc.massKg += p.massKg;
      acc.powerW += p.powerW;
      acc.costMUsd += p.costMUsd;
      acc.oxygenDays += p.oxygenDays;
      return acc;
    },
    { massKg: 0, powerW: 0, costMUsd: 0, oxygenDays: 0 },
  );
}

/** Adds or removes a part, dropping anything it can't be fitted with. */
export function togglePart(selected: PartId[], id: PartId): PartId[] {
  if (selected.includes(id)) return selected.filter((p) => p !== id);
  const excluded = PARTS_BY_ID[id].excludes ?? [];
  return [...selected.filter((p) => !excluded.includes(p)), id];
}

export interface DesignIssue {
  /** "blocker" stops the launch, "warning" lets it fly but will cause trouble. */
  severity: "blocker" | "warning";
  message: string;
}

/** Problems that stop the mission before it even launches. */
export function designIssues(selected: PartId[]): DesignIssue[] {
  const issues: DesignIssue[] = [];
  const t = totals(selected);
  if (!selected.includes("capsule")) issues.push({ severity: "blocker", message: "No crew capsule: there is nowhere for the crew to ride." });
  if (!selected.includes("serviceSmall") && !selected.includes("serviceLarge"))
    issues.push({ severity: "blocker", message: "No service module: the spacecraft has no engine." });
  if (t.powerW < 0) issues.push({ severity: "blocker", message: "Power is negative: the batteries will run flat." });
  if (t.oxygenDays < MISSION_REQUIREMENTS.durationDays)
    issues.push({
      severity: "blocker",
      message: `Oxygen for ${t.oxygenDays} days, the mission needs ${MISSION_REQUIREMENTS.durationDays}.`,
    });
  if (selected.includes("serviceSmall"))
    issues.push({
      severity: "warning",
      message: "Small tanks: enough fuel for a flyby, not to brake into lunar orbit.",
    });
  if (!selected.includes("radiationShield"))
    issues.push({ severity: "warning", message: "No radiation shield: a solar storm would put the crew at risk." });
  return issues;
}
