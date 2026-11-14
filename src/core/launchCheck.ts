// Can the chosen rocket carry the spacecraft towards the Moon?
//
// TODO: payload and cost values are placeholders. Replace with sourced figures
// for comparable real launchers and note where each number comes from.

export type RocketId = "light" | "medium" | "heavy";

export interface Rocket {
  id: RocketId;
  name: string;
  /** Mass it can send on a trans-lunar trajectory. */
  payloadToMoonKg: number;
  costMUsd: number;
}

export const ROCKETS: Rocket[] = [
  { id: "light", name: "Light", payloadToMoonKg: 9000, costMUsd: 150 }, // TODO: placeholder
  { id: "medium", name: "Medium", payloadToMoonKg: 20000, costMUsd: 450 }, // TODO: placeholder
  { id: "heavy", name: "Heavy", payloadToMoonKg: 27000, costMUsd: 1200 }, // TODO: placeholder
];

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
