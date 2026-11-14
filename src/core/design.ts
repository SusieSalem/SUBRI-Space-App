// Spacecraft parts and the totals they add up to.
//
// TODO: every number in this file is a placeholder picked to make the prototype
// playable. Replace them with sourced values (NASA Ames Small Spacecraft
// Technology report, Orion/ESM public fact sheets, etc.) and note the source
// next to each part.

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
  /** Parts that can't be fitted together with this one. */
  excludes?: PartId[];
}

export const PARTS: Part[] = [
  {
    id: "capsule",
    name: "Crew capsule",
    category: "crew",
    description: "Pressurised cabin for 4 crew, heat shield for re-entry.",
    massKg: 9300, // TODO: placeholder
    powerW: -1800, // TODO: placeholder
    costMUsd: 900, // TODO: placeholder
    oxygenDays: 1, // TODO: placeholder, emergency reserve only
  },
  {
    id: "serviceSmall",
    name: "Service module, small tanks",
    category: "propulsion",
    description: "Main engine and fuel for a short trip.",
    massKg: 9000, // TODO: placeholder
    powerW: -300, // TODO: placeholder
    costMUsd: 300, // TODO: placeholder
    oxygenDays: 0,
    excludes: ["serviceLarge"],
  },
  {
    id: "serviceLarge",
    name: "Service module, large tanks",
    category: "propulsion",
    description: "More fuel: enough to brake into lunar orbit and come back.",
    massKg: 15500, // TODO: placeholder
    powerW: -350, // TODO: placeholder
    costMUsd: 420, // TODO: placeholder
    oxygenDays: 0,
    excludes: ["serviceSmall"],
  },
  {
    id: "lifeSupport7",
    name: "Life support, 7 days",
    category: "lifeSupport",
    description: "Oxygen, water and CO2 scrubbing for a week.",
    massKg: 700, // TODO: placeholder
    powerW: -600, // TODO: placeholder
    costMUsd: 80, // TODO: placeholder
    oxygenDays: 7,
    excludes: ["lifeSupport14"],
  },
  {
    id: "lifeSupport14",
    name: "Life support, 14 days",
    category: "lifeSupport",
    description: "Two weeks of consumables. Heavier, but leaves a margin.",
    massKg: 1300, // TODO: placeholder
    powerW: -700, // TODO: placeholder
    costMUsd: 140, // TODO: placeholder
    oxygenDays: 14,
    excludes: ["lifeSupport7"],
  },
  {
    id: "solarPanels",
    name: "Solar panels",
    category: "power",
    description: "Four deployable wings. Without them the batteries run flat.",
    massKg: 450, // TODO: placeholder
    powerW: 11000, // TODO: placeholder
    costMUsd: 60, // TODO: placeholder
    oxygenDays: 0,
  },
  {
    id: "radiationShield",
    name: "Radiation shield",
    category: "protection",
    description: "Storm shelter for the crew during solar particle events.",
    massKg: 1400, // TODO: placeholder
    powerW: 0,
    costMUsd: 120, // TODO: placeholder
    oxygenDays: 0,
  },
];

export const PARTS_BY_ID: Record<PartId, Part> = Object.fromEntries(
  PARTS.map((p) => [p.id, p]),
) as Record<PartId, Part>;

/** What the first mission (lunar orbit and back) asks for. TODO: placeholder values. */
export const MISSION_REQUIREMENTS = {
  name: "Lunar orbit and return",
  durationDays: 8,
  budgetMUsd: 3200,
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
