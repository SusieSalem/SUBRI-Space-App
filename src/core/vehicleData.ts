// Engine and stage figures used by the flight physics.
//
// TODO-source: every number here is a placeholder sized so the three rockets
// behave sensibly (Light reaches orbit with a small crew vehicle, Heavy can
// send ~27 t towards the Moon). Replace with sourced values for comparable
// real stages and engines and note the source next to each one.

import type { RocketId } from "./launchCheck";

export interface StageData {
  dryKg: number;
  propKg: number;
  /** Total thrust of the stage's engines. */
  thrustVacN: number;
  thrustSlN: number;
  ispVac: number;
  ispSl: number;
}

export interface RocketData {
  /** Strap-on boosters (all of them together), burning alongside the first stage. */
  boosters: StageData | null;
  stage1: StageData;
  /** Upper stage: finishes the climb to orbit and does the trans-lunar injection. */
  stage2: StageData;
  /** Body diameter for drag (m). */
  diameter: number;
}

export const ROCKET_DATA: Record<RocketId, RocketData> = {
  light: {
    boosters: null,
    stage1: { dryKg: 22000, propKg: 290000, thrustVacN: 5.2e6, thrustSlN: 4.6e6, ispVac: 335, ispSl: 300 }, // TODO-source
    stage2: { dryKg: 3200, propKg: 40000, thrustVacN: 3.6e5, thrustSlN: 1.0e5, ispVac: 350, ispSl: 150 }, // TODO-source
    diameter: 3.4,
  },
  medium: {
    boosters: { dryKg: 2 * 9000, propKg: 2 * 90000, thrustVacN: 2 * 2.6e6, thrustSlN: 2 * 2.4e6, ispVac: 285, ispSl: 265 }, // TODO-source
    stage1: { dryKg: 42000, propKg: 580000, thrustVacN: 8.6e6, thrustSlN: 7.6e6, ispVac: 360, ispSl: 315 }, // TODO-source
    stage2: { dryKg: 7500, propKg: 140000, thrustVacN: 1.0e6, thrustSlN: 1.5e5, ispVac: 455, ispSl: 200 }, // TODO-source
    diameter: 4.4,
  },
  heavy: {
    boosters: { dryKg: 2 * 32000, propKg: 2 * 280000, thrustVacN: 2 * 7.6e6, thrustSlN: 2 * 7.0e6, ispVac: 285, ispSl: 265 }, // TODO-source
    stage1: { dryKg: 70000, propKg: 560000, thrustVacN: 9.2e6, thrustSlN: 7.6e6, ispVac: 452, ispSl: 366 }, // TODO-source
    stage2: { dryKg: 6500, propKg: 95000, thrustVacN: 5.5e5, thrustSlN: 1.5e5, ispVac: 462, ispSl: 200 }, // TODO-source
    diameter: 5.2,
  },
};

/** Launch escape system on top of the capsule, dropped once the air is thin. */
export const ESCAPE_TOWER_KG = 4000; // TODO-source

/** Crew spacecraft main engine (in the service module). */
export const SERVICE_ENGINE = { thrustN: 26700, isp: 316 }; // TODO-source

/** Propellant carried by each service module option (part of its total mass). */
export const SERVICE_PROPELLANT_KG = { serviceSmall: 3500, serviceLarge: 9000 }; // TODO-source

/** Capsule aerodynamics for re-entry and parachutes. */
export const CAPSULE = {
  diameter: 5.0,
  dragCoefficient: 1.3,
  /** Drag area (Cd * A) with all parachutes open. */
  parachuteCdA: 1500,
}; // TODO-source
