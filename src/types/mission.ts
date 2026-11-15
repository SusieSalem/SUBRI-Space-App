// src/types/mission.ts — Contrato de Tipos Compartidos (Congelado)
export type Difficulty = 'easy' | 'engineer';
export type SubsystemType =
	| 'structure'
	| 'solar'
	| 'battery'
	| 'antenna'
	| 'computer'
	| 'attitude'
	| 'instrument';
export type OrbitId = 'leo' | 'sso' | 'geo' | 'lunar_polar';
export type RocketId = 'small' | 'medium' | 'heavy' | 'rideshare';

export interface CelestialBodyConfig {
	id: 'earth' | 'moon';
	name: string;
	radiusKm: number;	// Tierra: 6371 | Luna: 1737.4
	muKm3s2: number;	// Tierra: 398600.4 | Luna: 4902.8
	rotationPeriodSec: number;	// Tierra: 86164 | Luna: 2360591
	textureUrl: string;
	hasAtmosphereDrag: boolean;
}

export interface PartSpec {
	id: string;
	subsystem: SubsystemType;
	name: string;
	tier: Difficulty;	// 'easy' disponible en ambos; 'engineer' solo en Engineer
	massKg: number;
	powerW: number;	// positivo = genera (paneles), negativo = consume
	costM: number;	// millones USD
	dataRateGBPerDay: number;	// positivo = baja datos (antena), negativo = genera datos
	scienceValue: number;
	angularResRad?: number;	// solo instrumentos
	reliability: number;	// 0..1 (probabilidad contra fallos)
	shapeHint: 'bus_sm' | 'bus_md' | 'panel_body' | 'panel_deploy' | 'dish_s' | 'dish_x' | 'sensor';
	hintText: string;
	sourceLabel: string;
	sourceUrl: string;
}

export interface SpacecraftDesign {
	structure: PartSpec;
	solar: PartSpec;
	battery: PartSpec;
	antenna: PartSpec;
	computer: PartSpec;
	attitude: PartSpec;
	instruments: PartSpec[];
}

export interface DesignTotals {
	totalMassKg: number;
	powerBalanceW: number;	// generacion - consumo
	batteryCapacityWh: number;
	totalCostM: number;
	dataGeneratedGBDay: number;
	downlinkCapacityGBDay: number;
	storageCapacityGB: number;
	scienceScoreBase: number;
}

export interface OrbitMetrics {
	orbitId: OrbitId;
	altitudeKm: number;
	inclinationDeg: number;
	periodMinutes: number;	// Tercera ley de Kepler: T = 2 * pi * sqrt(a^3 / mu)
	eclipseMinutes: number;	// sombra cilindrica
	revisitHours: number;
	groundResolutionKm: number;	// altitud * resolucion angular
	contactMinutesPerDay: number;
	expectedLifetimeYears: number;
}

export interface LaunchCheckResult {
	fits: boolean;
	reasons: string[];	// ej. "El cohete pequeno no alcanza orbita GEO"
	totalMissionCostM: number;	// satelite + cohete
}

export interface SimulationStep {
	day: number;
	batteryPct: number;
	memoryUsedGB: number;
	dataSentGB: number;
	targetsDetected: number;	// incendios (Tierra) o depositos de hielo (Luna)
	activeEvents: string[];
}

export interface MissionReportData {
	passed: boolean;
	stars: 1 | 2 | 3;
	scores: { objective: number; science: number; efficiency: number; decisions: number };
	history: SimulationStep[];
	rootCauses: { problem: string; explanation: string; suggestion: string }[];
}
