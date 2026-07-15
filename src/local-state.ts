import type { BlueprintRecord } from "./blueprints.js";
import type { ModuleRecord } from "./modules.js";

export type StarterHumanRecord = {
  id: string;
  displayName: string;
  locationModuleId: string;
};

export type AlertContractRecord = {
  schemaVersion: string;
  schema: Record<string, unknown>;
};

export type HabitatAlertContracts = {
  alerts: AlertContractRecord;
};

export type CarriedResourceRecord = {
  resourceType: string;
  quantityKg: number;
};

export type LocalEvaState = {
  deployedHumanId: string | null;
  suitportModuleId: string | null;
  position: {
    x: number;
    y: number;
  } | null;
  carriedResources: CarriedResourceRecord[];
  carryCapacityKg: number;
};

export type AlertRecord = {
  id: string;
  code: string;
  title: string;
  description: string;
  severity: "info" | "warning" | "critical";
  status: "open" | "acknowledged" | "resolved";
  source: string;
  openedAt: string;
  lastObservedAt: string;
  occurrenceCount: number;
  subject?: {
    type: "human" | "module";
    id: string;
  };
  acknowledgedAt?: string;
  resolvedAt?: string;
  details?: Record<string, unknown>;
};

export type HabitatRegistrationRecord = {
  baseUrl: string;
  displayName: string;
  habitatUuid: string;
  habitatId: string;
  habitatSlug?: string;
  status?: string;
  catalogVersion?: string;
  lastSeenAt?: string | null;
  contracts?: HabitatAlertContracts;
  starterModules: ModuleRecord[];
  starterHumans: StarterHumanRecord[];
  blueprints: BlueprintRecord[];
};

export type LocalSimulationState = {
  currentTick?: number;
  lastTickAt?: string;
  lastPowerDrawKw?: number;
  lastEnergyRequestedKwh?: number;
  lastEnergyDrainedKwh?: number;
  lastPowerShortfallKwh?: number;
};

export type LocalState = {
  kepler?: HabitatRegistrationRecord;
  inventory?: Record<string, number>;
  modules?: ModuleRecord[];
  humans?: StarterHumanRecord[];
  eva?: LocalEvaState;
  alerts?: AlertRecord[];
  simulation?: LocalSimulationState;
} & Record<string, unknown>;

export function cloneModule(module: ModuleRecord): ModuleRecord {
  return {
    ...module,
    connectedTo: [...module.connectedTo],
    runtimeAttributes: { ...module.runtimeAttributes },
    capabilities: [...module.capabilities],
  };
}

export function normalizeState(state: LocalState): LocalState {
  if (!Array.isArray(state.modules) && state.kepler?.starterModules) {
    return {
      ...state,
      modules: state.kepler.starterModules.map(cloneModule),
    };
  }

  return state;
}
