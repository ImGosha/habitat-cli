import type { LocalEvaState, LocalState } from "./local-state.js";
import type { ModuleRecord } from "./modules.js";
import { findModuleById } from "./modules.js";
import { formatKeyValueRows, formatSection, formatTable } from "./cli-format.js";

export type WorldSectorBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

const defaultCarryCapacityKg = 20;

export function getEvaState(state: LocalState): LocalEvaState {
  return (
    state.eva ?? {
      deployedHumanId: null,
      suitportModuleId: null,
      position: null,
      carriedResources: [],
      carryCapacityKg: defaultCarryCapacityKg,
    }
  );
}

export function findSuitportModule(modules: ModuleRecord[] | undefined): ModuleRecord | undefined {
  return modules?.find((module) => module.capabilities.includes("suitport-access"));
}

export function humanIsInSuitport(state: LocalState, humanId: string): ModuleRecord | undefined {
  const human = state.humans?.find((entry) => entry.id === humanId);
  if (!human) {
    return undefined;
  }

  const module = findModuleById(state.modules, human.locationModuleId);
  if (!module || !module.capabilities.includes("suitport-access")) {
    return undefined;
  }

  return module;
}

export function deployHumanForEva(state: LocalState, humanId: string): LocalEvaState {
  const suitportModule = humanIsInSuitport(state, humanId);

  if (!suitportModule) {
    throw new Error(`Human "${humanId}" must be in a suitport module before EVA deployment.`);
  }

  const existingEva = getEvaState(state);
  if (existingEva.deployedHumanId) {
    throw new Error(`Human "${existingEva.deployedHumanId}" is already deployed outside the habitat.`);
  }

  const nextEvaState: LocalEvaState = {
    deployedHumanId: humanId,
    suitportModuleId: suitportModule.id,
    position: { x: 0, y: 0 },
    carriedResources: [],
    carryCapacityKg: existingEva.carryCapacityKg || defaultCarryCapacityKg,
  };

  state.eva = nextEvaState;
  return nextEvaState;
}

export function moveEva(state: LocalState, x: number, y: number, bounds: WorldSectorBounds): LocalEvaState {
  const eva = getEvaState(state);

  if (!eva.deployedHumanId || !eva.position) {
    throw new Error("No human is currently deployed for EVA.");
  }

  const deltaX = Math.abs(x - eva.position.x);
  const deltaY = Math.abs(y - eva.position.y);
  const isCardinalStep = deltaX + deltaY === 1;

  if (!isCardinalStep) {
    throw new Error("EVA movement must be exactly one tile north, south, east, or west.");
  }

  if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) {
    throw new Error("EVA movement cannot leave the current Kepler sector.");
  }

  eva.position = { x, y };
  state.eva = eva;
  return eva;
}

export function ensureDockable(eva: LocalEvaState): void {
  if (!eva.deployedHumanId || !eva.position) {
    throw new Error("No human is currently deployed for EVA.");
  }

  if (eva.position.x !== 0 || eva.position.y !== 0) {
    throw new Error("EVA docking is only allowed at habitat origin (0, 0).");
  }
}

export function formatEvaStatus(eva: LocalEvaState): string {
  const carriedRows =
    eva.carriedResources.length === 0
      ? "No carried resources."
      : formatTable(
          ["Resource", "Quantity (kg)"],
          eva.carriedResources.map((resource) => [resource.resourceType, String(resource.quantityKg)]),
        );

  return [
    formatSection(
      "EVA Status",
      formatKeyValueRows([
        ["Explorer", eva.deployedHumanId ?? "None"],
        ["Suitport", eva.suitportModuleId ?? "None"],
        ["Position", eva.position ? `(${eva.position.x}, ${eva.position.y})` : "Not deployed"],
        ["Carry Capacity", `${eva.carryCapacityKg} kg`],
      ]),
    ),
    formatSection("Carried Resources", carriedRows),
  ].join("\n\n");
}
