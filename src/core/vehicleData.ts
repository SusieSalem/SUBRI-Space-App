// Engine and stage figures used by the flight physics, from
// public/data/crewed_lunar.json: Falcon 9-class (Light), Falcon Heavy-class
// (Medium) and SLS Block 1 (Heavy) stages, the Orion launch abort system, the
// ESM main engine (AJ10-190) and the capsule's aerodynamics.

import { CREWED, crewedRocket } from "./crewedData";
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

function rocketData(id: RocketId): RocketData {
  const r = crewedRocket(id);
  return { boosters: r.boosters, stage1: r.stage1, stage2: r.stage2, diameter: r.diameterM };
}

export const ROCKET_DATA: Record<RocketId, RocketData> = {
  light: rocketData("light"),
  medium: rocketData("medium"),
  heavy: rocketData("heavy"),
};

const vd = CREWED.vehicleData;

/** Launch abort system on top of the capsule, dropped once the air is thin. */
export const ESCAPE_TOWER_KG = vd.escapeTowerKg;

/** Crew spacecraft main engine (in the service module). */
export const SERVICE_ENGINE = { thrustN: vd.serviceEngine.thrustN, isp: vd.serviceEngine.isp };

/** Propellant carried by each service module option (part of its total mass). */
export const SERVICE_PROPELLANT_KG = vd.servicePropellantKg;

/** Capsule aerodynamics for re-entry and parachutes. */
export const CAPSULE = vd.capsule;
