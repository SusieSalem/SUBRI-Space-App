// shared types for mission simulation
export type Difficulty = 'easy' | 'engineer';

// subsystems
export type SubsystemType =
	| 'structure'
	| 'solar'
	| 'battery'
	| 'antenna'
	| 'computer'
	| 'attitude'
	| 'instrument';

// orbits
export type OrbitId =
	| 'leo'
	| 'sso'
	| 'geo'
	| 'lunar_polar'
	| 'lunar_frozen'
	| 'lunar_equatorial';

// rocket types
export type RocketId = 'small' | 'medium' | 'heavy' | 'rideshare';

// celestial bodies
export interface CelestialBodyConfig {
	id: 'earth' | 'moon';
	name: string;
	radiusKm: number;	// earth = 6371 | moon = 1737.4
	muKm3s2: number;	// earth: 398600.4 | moon: 4902.8
	rotationPeriodSec: number;	// earth: 86164 | moon: 2360591
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
	batteryCapacityWh?: number;	// solo baterias (ej. 40 Wh, 120 Wh)
	storageCapacityGB?: number;	// solo computadoras a bordo (ej. 32 GB, 128 GB)
	targetBodies?: ('earth' | 'moon')[];	// cuerpos donde aplica el instrumento
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

// dataset contracts

export interface RocketSpec {
	id: RocketId;
	name: string;
	vehicleInspiration: string;
	costM: number;
	costPer100KgM?: number;
	maxPayloadKg: Record<OrbitId, number | null>;
	hintText: string;
	sourceLabel: string;
	sourceUrl: string;
}

export interface GroundStationSpec {
	id: string;
	name: string;
	network: string;
	lat: number;
	lon: number;
	minElevationDeg: number;
	supportedBands: ('S' | 'X' | 'Ka')[];
	maxDownlinkGBPerPass: number;
	sourceLabel: string;
	sourceUrl: string;
}

export interface FireTargetSpec {
	id: string;
	name: string;
	region: string;
	lat: number;
	lon: number;
	brightnessK: number;
	frpMW: number;
	acquiredDate: string;
	satellite: string;
	instrument: string;
	confidence: 'nominal' | 'high';
	scienceValue: number;
	sourceUrl: string;	// FIRMS archive file that contains this exact detection
}

export interface SolarStormSpec {
	id: string;
	donkiActivityId: string;
	title: string;
	startTimeUtc: string;
	peakTimeUtc: string;
	eventType: 'CME' | 'GST' | 'SEP' | 'FLR';
	kpIndex: number;
	protonFluxPfu: number;
	safeModeHours: number;
	batteryDrainPct: number;
	unshieldedFailureProb: number;
	missionDayTrigger: number;
	description: string;
	sourceUrl: string;
}

export interface OrbitPresetSpec extends OrbitMetrics {
	name: string;
	periseleneKm?: number;
	aposeleneKm?: number;
	coversBothPoles?: boolean;
	goodAt: string;
	badAt: string;
	hintText: string;
	sourceLabel: string;
	sourceUrl: string;
}

export interface ScenarioSpec {
	id: string;
	title: string;
	celestialBodyId: 'earth' | 'moon' | 'mars';
	status: 'mvp' | 'stretch';
	goal: string;
	requirements: {
		budgetM: number;
		missionDurationYears: number;
		missionDurationDays: number;
		maxRevisitHours?: number;
		maxGroundResolutionKm?: number;
		requireBothPoles?: boolean;
		minInclinationDeg?: number;
		minTargetsDetected?: number;
	};
	educationalNote: string;
	bodyConfigUrl?: string;
	partsUrl?: string;	// catalogo propio del escenario (ej. Orion)
	orbitsUrl?: string;
	targetsUrl?: string;
}

export interface EducationalExplanation {
	id: string;
	term: string;
	shortExplanation: string;
	tradeOffTip: string;
	formula: string;
	sourceLabel: string;
	sourceUrl: string;
}

export interface CrewedPartSpec {
	id: string;
	name: string;
	category: 'crew' | 'propulsion' | 'lifeSupport' | 'power' | 'protection';
	massKg: number;
	powerW: number;
	costMUsd: number;
	oxygenDays: number;
	propellantKg?: number;
	notes: string;
	sourceLabel: string;
	sourceUrl: string;
}

export interface CrewedStageSpec {
	dryKg: number;
	propKg: number;
	thrustVacN: number;
	thrustSlN: number;
	ispVac: number;
	ispSl: number;
}

export interface CrewedRocketSpec {
	id: 'light' | 'medium' | 'heavy';
	name: string;
	realAnalog: string;
	payloadToMoonKg: number;
	payloadToMoonNote?: string;
	costMUsd: number;
	diameterM: number;
	boosters: CrewedStageSpec | null;
	stage1: CrewedStageSpec;
	stage2: CrewedStageSpec;
	realReference: Record<string, unknown>;
	notes: string;
	sourceLabel: string;
	sourceUrl: string;
}

export interface CrewedLunarDataset {
	dataset: string;
	archivedDataNotice: string;
	missionRequirements: {
		name: string;
		durationDays: number;
		extendedDurationDays: number;
		crewCount: number;
		budgetMUsd: number;
	};
	parts: CrewedPartSpec[];
	rockets: CrewedRocketSpec[];
	vehicleData: {
		escapeTowerKg: number;
		escapeTowerRealLasKg: number;
		serviceEngine: { name: string; thrustN: number; isp: number; dryKg: number; sourceUrl: string };
		servicePropellantKg: { serviceSmall: number; serviceLarge: number };
		capsule: { diameter: number; dragCoefficient: number; parachuteCdA: number; sourceUrl: string };
	};
}
