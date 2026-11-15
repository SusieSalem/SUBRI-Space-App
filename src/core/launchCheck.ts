// Can the chosen rocket carry the spacecraft towards the Moon?
// Payload to the Moon and cost come from public/data/crewed_lunar.json.

import { crewedRocket } from "./crewedData";

export type RocketId = "light" | "medium" | "heavy";

export interface Rocket {
  id: RocketId;
  /** Short label for buttons. */
  name: string;
  /** Full class name from the dataset, e.g. "Heavy (NASA SLS Block 1)". */
  fullName: string;
  realAnalog: string;
  payloadNote?: string;
  sourceLabel: string;
  sourceUrl: string;
  /** Mass it can send on a trans-lunar trajectory. */
  payloadToMoonKg: number;
  costMUsd: number;
}

const SHORT_NAME: Record<RocketId, string> = { light: "Light", medium: "Medium", heavy: "Heavy" };

export const ROCKETS: Rocket[] = (["light", "medium", "heavy"] as RocketId[]).map((id) => {
  const d = crewedRocket(id);
  return {
    id,
    name: SHORT_NAME[id],
    fullName: d.name,
    realAnalog: d.realAnalog,
    payloadNote: d.payloadToMoonNote,
    sourceLabel: d.sourceLabel,
    sourceUrl: d.sourceUrl,
    payloadToMoonKg: d.payloadToMoonKg,
    costMUsd: d.costMUsd,
  };
});

export const ROCKETS_BY_ID: Record<RocketId, Rocket> = Object.fromEntries(
  ROCKETS.map((r) => [r.id, r]),
) as Record<RocketId, Rocket>;

export interface LaunchCheck {
  fits: boolean;
  /** Spare capacity in kg. Negative means the spacecraft is too heavy. */
  marginKg: number;
  /** Share of the rocket's capacity used, 0..1+. */
  usage: number;
}

export function launchCheck(spacecraftMassKg: number, rocketId: RocketId): LaunchCheck {
  const rocket = ROCKETS_BY_ID[rocketId];
  const marginKg = rocket.payloadToMoonKg - spacecraftMassKg;
  return {
    fits: marginKg >= 0,
    marginKg,
    usage: spacecraftMassKg / rocket.payloadToMoonKg,
  };
}
