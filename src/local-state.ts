import type { BlueprintRecord } from "./blueprints.js";
import type { ModuleRecord } from "./modules.js";

export type HabitatRegistrationRecord = {
  baseUrl: string;
  displayName: string;
  habitatUuid: string;
  habitatId: string;
  habitatSlug?: string;
  status?: string;
  catalogVersion?: string;
  lastSeenAt?: string | null;
  starterModules: ModuleRecord[];
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
