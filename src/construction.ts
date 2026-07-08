import { randomUUID } from "node:crypto";
import type { BlueprintRecord } from "./blueprints.js";
import type { ModuleRecord } from "./modules.js";

export type Inventory = Record<string, number>;

export type ConstructionJob = {
  blueprintId: string;
  displayName: string;
  outputItemType: string;
  outputModuleType: string;
  totalTicks: number;
  remainingTicks: number;
  startedAtTick: number;
  inputs: Inventory;
  runtimeAttributes: Record<string, unknown>;
  capabilities: string[];
};

export type ConstructionState = {
  inventory?: Inventory;
  modules?: ModuleRecord[];
  simulation?: {
    currentTick?: number;
  };
} & Record<string, unknown>;

export type ConstructionPreview = {
  blueprintId: string;
  facilityId: string;
  facilityDisplayName: string;
  totalTicks: number;
  missingResources: Inventory;
  inventoryAfter: Inventory;
};

export type ConstructionStartResult = {
  blueprintId: string;
  facilityId: string;
  remainingTicks: number;
};

export type ConstructionCancelResult = {
  facilityId: string;
};

export type ConstructionAdvanceResult = {
  completedModules: ModuleRecord[];
};

const defaultStarterInventory: Inventory = {
  ferrite: 300,
  "silicate-glass": 150,
  "conductive-ore": 80,
  "basalt-composite": 160,
  "rare-catalyst": 10,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toIdToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "_");
}

function getBlueprintInputs(blueprint: BlueprintRecord): Inventory {
  if (!isPlainObject(blueprint.inputs)) {
    return {};
  }

  const inputs: Inventory = {};

  for (const [resourceType, quantity] of Object.entries(blueprint.inputs)) {
    const numericQuantity = getFiniteNumber(quantity);

    if (numericQuantity !== undefined && numericQuantity > 0) {
      inputs[resourceType] = numericQuantity;
    }
  }

  return inputs;
}

function getRequiredFacilityModuleType(blueprint: BlueprintRecord): string {
  const requiredFacility = isPlainObject(blueprint.requiredFacility) ? blueprint.requiredFacility : undefined;
  return typeof requiredFacility?.moduleType === "string" ? requiredFacility.moduleType : "workshop-fabricator";
}

function getOutputItemType(blueprint: BlueprintRecord): string {
  return isPlainObject(blueprint.output) && typeof blueprint.output.itemType === "string" ? blueprint.output.itemType : "";
}

function getOutputModuleType(blueprint: BlueprintRecord): string {
  if (isPlainObject(blueprint.output) && typeof blueprint.output.moduleType === "string") {
    return blueprint.output.moduleType;
  }

  return blueprint.blueprintId;
}

function getBuildTicks(blueprint: BlueprintRecord): number {
  return getFiniteNumber(blueprint.buildTicks) ?? 0;
}

function createModuleDisplayName(blueprint: BlueprintRecord): string {
  return blueprint.displayName.replace(/ Blueprint$/, "");
}

function createModuleId(moduleType: string, createId: () => string): string {
  return `local_${toIdToken(moduleType)}_${toIdToken(createId())}`;
}

export function getEffectiveInventory(state: ConstructionState): Inventory {
  return state.inventory ? { ...state.inventory } : { ...defaultStarterInventory };
}

export function getConstructionJob(module: ModuleRecord): ConstructionJob | undefined {
  return isPlainObject(module.runtimeAttributes.constructionJob)
    ? (module.runtimeAttributes.constructionJob as ConstructionJob)
    : undefined;
}

export function findAvailableConstructionFacility(
  state: ConstructionState,
  blueprint: BlueprintRecord,
): ModuleRecord | undefined {
  const requiredModuleType = getRequiredFacilityModuleType(blueprint);

  return state.modules?.find((module) => {
    if (module.blueprintId !== requiredModuleType) {
      return false;
    }

    if (getConstructionJob(module)) {
      return false;
    }

    return module.runtimeAttributes.status === "idle" || module.runtimeAttributes.status === "active";
  });
}

function createMissingResources(inputs: Inventory, inventory: Inventory): Inventory {
  const missing: Inventory = {};

  for (const [resourceType, requiredQuantity] of Object.entries(inputs)) {
    const availableQuantity = getFiniteNumber(inventory[resourceType]) ?? 0;

    if (availableQuantity < requiredQuantity) {
      missing[resourceType] = requiredQuantity - availableQuantity;
    }
  }

  return missing;
}

function createInventoryAfter(inputs: Inventory, inventory: Inventory): Inventory {
  const inventoryAfter = { ...inventory };

  for (const [resourceType, requiredQuantity] of Object.entries(inputs)) {
    inventoryAfter[resourceType] = (getFiniteNumber(inventoryAfter[resourceType]) ?? 0) - requiredQuantity;
  }

  return inventoryAfter;
}

function createConstructionJob(state: ConstructionState, blueprint: BlueprintRecord): ConstructionJob {
  return {
    blueprintId: blueprint.blueprintId,
    displayName: blueprint.displayName,
    outputItemType: getOutputItemType(blueprint),
    outputModuleType: getOutputModuleType(blueprint),
    totalTicks: getBuildTicks(blueprint),
    remainingTicks: getBuildTicks(blueprint),
    startedAtTick: getFiniteNumber(state.simulation?.currentTick) ?? 0,
    inputs: getBlueprintInputs(blueprint),
    runtimeAttributes: { ...(blueprint.runtimeAttributes ?? {}) },
    capabilities: [...(blueprint.capabilities ?? [])],
  };
}

function validateConstructableBlueprint(blueprint: BlueprintRecord): void {
  if (getOutputItemType(blueprint) !== "module") {
    throw new Error(`Blueprint "${blueprint.blueprintId}" does not create a module.`);
  }

  if (getBuildTicks(blueprint) <= 0) {
    throw new Error(`Blueprint "${blueprint.blueprintId}" does not have a valid build time.`);
  }
}

export function previewConstruction(state: ConstructionState, blueprint: BlueprintRecord): ConstructionPreview {
  validateConstructableBlueprint(blueprint);

  const facility = findAvailableConstructionFacility(state, blueprint);

  if (!facility) {
    throw new Error(`No idle ${getRequiredFacilityModuleType(blueprint)} facility is available.`);
  }

  const inventory = getEffectiveInventory(state);
  const inputs = getBlueprintInputs(blueprint);
  const missingResources = createMissingResources(inputs, inventory);

  if (Object.keys(missingResources).length > 0) {
    throw new Error(
      `Not enough local inventory for "${blueprint.blueprintId}". Missing: ${Object.entries(missingResources)
        .map(([resourceType, quantity]) => `${resourceType} ${quantity}`)
        .join(", ")}.`,
    );
  }

  return {
    blueprintId: blueprint.blueprintId,
    facilityId: facility.id,
    facilityDisplayName: facility.displayName,
    totalTicks: getBuildTicks(blueprint),
    missingResources,
    inventoryAfter: createInventoryAfter(inputs, inventory),
  };
}

export function startConstruction(state: ConstructionState, blueprint: BlueprintRecord): ConstructionStartResult {
  const preview = previewConstruction(state, blueprint);
  const facility = state.modules?.find((module) => module.id === preview.facilityId);

  if (!facility) {
    throw new Error(`Facility "${preview.facilityId}" was not found.`);
  }

  state.inventory = preview.inventoryAfter;
  facility.runtimeAttributes.status = "active";
  facility.runtimeAttributes.constructionJob = createConstructionJob(state, blueprint);

  return {
    blueprintId: blueprint.blueprintId,
    facilityId: facility.id,
    remainingTicks: getBuildTicks(blueprint),
  };
}

export function cancelConstruction(state: ConstructionState, facility: ModuleRecord): ConstructionCancelResult {
  const job = getConstructionJob(facility);

  if (!job) {
    throw new Error(`Facility "${facility.id}" does not have an active construction job.`);
  }

  delete facility.runtimeAttributes.constructionJob;
  facility.runtimeAttributes.status = "idle";

  return {
    facilityId: facility.id,
  };
}

export function advanceConstructionJobs(
  state: ConstructionState,
  tickCount: number,
  createId: () => string = randomUUID,
): ConstructionAdvanceResult {
  const completedModules: ModuleRecord[] = [];

  for (const facility of state.modules ?? []) {
    const job = getConstructionJob(facility);

    if (!job) {
      continue;
    }

    job.remainingTicks = Math.max(0, job.remainingTicks - tickCount);

    if (job.remainingTicks > 0) {
      facility.runtimeAttributes.constructionJob = job;
      continue;
    }

    const completedModule: ModuleRecord = {
      id: createModuleId(job.outputModuleType, createId),
      blueprintId: job.outputModuleType,
      displayName: createModuleDisplayName({
        blueprintId: job.blueprintId,
        displayName: job.displayName,
      } as BlueprintRecord),
      connectedTo: [],
      runtimeAttributes: { ...job.runtimeAttributes },
      capabilities: [...job.capabilities],
    };

    state.modules = [...(state.modules ?? []), completedModule];
    completedModules.push(completedModule);
    delete facility.runtimeAttributes.constructionJob;
    facility.runtimeAttributes.status = "idle";
  }

  return {
    completedModules,
  };
}

export function formatConstructionStatus(modules: ModuleRecord[]): string {
  const rows = modules
    .map((module) => ({
      facility: module.displayName,
      job: getConstructionJob(module),
    }))
    .filter((entry) => entry.job !== undefined)
    .map((entry) => ({
      facility: entry.facility,
      blueprintId: entry.job?.blueprintId ?? "unknown",
      remainingTicks: String(entry.job?.remainingTicks ?? 0),
      output: entry.job?.outputItemType ?? "unknown",
    }));

  if (rows.length === 0) {
    return "No active construction jobs.";
  }

  const facilityWidth = Math.max("Facility".length, 20, ...rows.map((row) => row.facility.length));
  const blueprintWidth = Math.max("Blueprint".length, ...rows.map((row) => row.blueprintId.length));
  const remainingWidth = Math.max("Remaining Ticks".length, ...rows.map((row) => row.remainingTicks.length));
  const outputWidth = Math.max("Output".length, ...rows.map((row) => row.output.length));
  const lines = [
    `${"Facility".padEnd(facilityWidth)}  ${"Blueprint".padEnd(blueprintWidth)}  ${"Remaining Ticks".padEnd(remainingWidth)}  ${"Output".padEnd(outputWidth)}`,
    `${"-".repeat(facilityWidth)}  ${"-".repeat(blueprintWidth)}  ${"-".repeat(remainingWidth)}  ${"-".repeat(outputWidth)}`,
  ];

  for (const row of rows) {
    lines.push(
      `${row.facility.padEnd(facilityWidth)}  ${row.blueprintId.padEnd(blueprintWidth)}  ${row.remainingTicks.padEnd(remainingWidth)}  ${row.output}`,
    );
  }

  return lines.join("\n");
}
