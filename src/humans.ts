import type { StarterHumanRecord } from "./local-state.js";
import type { ModuleRecord } from "./modules.js";
import { formatTable } from "./cli-format.js";

export function findHumanById(humans: StarterHumanRecord[] | undefined, humanId: string): StarterHumanRecord | undefined {
  return humans?.find((human) => human.id === humanId);
}

export function listHumansInModule(humans: StarterHumanRecord[] | undefined, moduleId: string): StarterHumanRecord[] {
  return (humans ?? []).filter((human) => human.locationModuleId === moduleId);
}

export function getModuleCrewCapacity(module: ModuleRecord): number {
  const crewCapacity = module.runtimeAttributes.crewCapacity;
  return typeof crewCapacity === "number" && Number.isFinite(crewCapacity) ? crewCapacity : 0;
}

export function canMoveHumanToModule(
  humans: StarterHumanRecord[] | undefined,
  module: ModuleRecord,
  movingHumanId: string,
): boolean {
  const occupants = listHumansInModule(humans, module.id).filter((human) => human.id !== movingHumanId);
  return occupants.length < getModuleCrewCapacity(module);
}

export function formatHumanList(humans: StarterHumanRecord[]): string {
  if (humans.length === 0) {
    return "No humans found.";
  }

  return formatTable(
    ["Human ID", "Display Name", "Location Module"],
    humans.map((human) => [human.id, human.displayName, human.locationModuleId]),
  );
}
