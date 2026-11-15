// The crewed lunar reference dataset (public/data/crewed_lunar.json), typed by
// the team's contract in src/types/mission.ts. Built by data-prep/build_all_data.py
// from NASA Orion, ESA ESM, SLS and commercial launcher fact sheets.
// Imported at build time so the core stays synchronous and works offline.

import raw from "../../public/data/crewed_lunar.json";
import type { CrewedLunarDataset, CrewedPartSpec, CrewedRocketSpec } from "../types/mission";

export const CREWED: CrewedLunarDataset = raw as CrewedLunarDataset;

export function crewedPart(id: string): CrewedPartSpec {
  const p = CREWED.parts.find((x) => x.id === id);
  if (!p) throw new Error(`crewed_lunar.json has no part "${id}"`);
  return p;
}

export function crewedRocket(id: "light" | "medium" | "heavy"): CrewedRocketSpec {
  const r = CREWED.rockets.find((x) => x.id === id);
  if (!r) throw new Error(`crewed_lunar.json has no rocket "${id}"`);
  return r;
}
