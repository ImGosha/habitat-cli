import { describe, expect, test } from "bun:test";
import type { BlueprintRecord } from "./blueprints.js";
import type { ModuleRecord } from "./modules.js";
import {
  advanceConstructionJobs,
  cancelConstruction,
  formatConstructionStatus,
  previewConstruction,
  startConstruction,
  type ConstructionState,
} from "./construction.js";

function moduleRecord(overrides: Partial<ModuleRecord>): ModuleRecord {
  return {
    id: "module_1",
    blueprintId: "test-module",
    displayName: "Test Module",
    connectedTo: [],
    runtimeAttributes: {},
    capabilities: [],
    ...overrides,
  };
}

function createState(): ConstructionState {
  return {
    inventory: {
      ferrite: 120,
      "silicate-glass": 60,
      "conductive-ore": 30,
    },
    modules: [
      moduleRecord({
        id: "habitat_123_workshop_fabricator_1",
        blueprintId: "workshop-fabricator",
        displayName: "Workshop Fabricator",
        runtimeAttributes: {
          status: "idle",
          powerDrawKw: {
            idle: 1,
            active: 8,
          },
        },
        capabilities: ["basic-fabrication"],
      }),
      moduleRecord({
        id: "habitat_123_supply_cache_1",
        blueprintId: "supply-cache",
        displayName: "Supply Cache",
        runtimeAttributes: {
          status: "online",
        },
        capabilities: ["storage"],
      }),
      moduleRecord({
        id: "habitat_123_command_module_1",
        blueprintId: "command-module",
        displayName: "Command Module",
        runtimeAttributes: {
          status: "active",
        },
      }),
    ],
    simulation: {
      currentTick: 0,
    },
  };
}

const smallSolarArrayBlueprint = {
  id: "blueprint_kepler-442b-v1_small-solar-array",
  blueprintId: "small-solar-array",
  displayName: "Small Solar Array Blueprint",
  description: "Generates starter solar power during clear daylight.",
  status: "published",
  output: {
    itemType: "module",
    moduleType: "small-solar-array",
    quantity: 1,
  },
  inputs: {
    ferrite: 90,
    "silicate-glass": 45,
    "conductive-ore": 18,
  },
  requiredFacility: {
    moduleType: "workshop-fabricator",
    minimumLevel: 1,
  },
  buildTicks: 180,
  prerequisites: ["command-module"],
  repeatable: true,
  runtimeAttributes: {
    health: 100,
    status: "online",
    powerGenerationKw: 12,
  },
  capabilities: ["solar-generation"],
} as BlueprintRecord;

describe("construction preview", () => {
  test("previews a construction job with all required checks and without mutating local state", () => {
    const state = createState();
    const before = JSON.parse(JSON.stringify(state));

    const preview = previewConstruction(state, smallSolarArrayBlueprint);

    expect(preview.blueprintId).toBe("small-solar-array");
    expect(preview.facilityId).toBe("habitat_123_workshop_fabricator_1");
    expect(preview.outputModuleId).toBe("local_small_solar_array_1");
    expect(preview.totalTicks).toBe(180);
    expect(preview.requiredFacilityExists).toBe(true);
    expect(preview.facilityAvailable).toBe(true);
    expect(preview.supplyCacheOnline).toBe(true);
    expect(preview.prerequisitesMet).toBe(true);
    expect(preview.canStart).toBe(true);
    expect(preview.missingResources).toEqual({});
    expect(preview.inventoryAfter).toEqual({
      ferrite: 30,
      "silicate-glass": 15,
      "conductive-ore": 12,
    });
    expect(state).toEqual(before);
  });

  test("fails when the supply cache is not online", () => {
    const state = createState();
    state.modules?.[1] && (state.modules[1].runtimeAttributes.status = "offline");

    expect(() => previewConstruction(state, smallSolarArrayBlueprint)).toThrow(
      'Supply cache must be online before starting "small-solar-array".',
    );
  });

  test("fails when prerequisites are missing", () => {
    const state = createState();
    state.modules = (state.modules ?? []).filter((module) => module.blueprintId !== "command-module");

    expect(() => previewConstruction(state, smallSolarArrayBlueprint)).toThrow(
      'Prerequisites are not met for "small-solar-array". Missing: command-module.',
    );
  });
});

describe("construction start and cancel", () => {
  test("starts a construction job, spends inventory, and marks the workshop active", () => {
    const state = createState();

    const result = startConstruction(state, smallSolarArrayBlueprint);
    const facility = state.modules?.[0];

    expect(result.facilityId).toBe("habitat_123_workshop_fabricator_1");
    expect(result.remainingTicks).toBe(180);
    expect(result.outputModuleId).toBe("local_small_solar_array_1");
    expect(state.inventory).toEqual({
      ferrite: 30,
      "silicate-glass": 15,
      "conductive-ore": 12,
    });
    expect(facility?.runtimeAttributes.status).toBe("active");
    expect(facility?.runtimeAttributes.constructionJob).toEqual({
      blueprintId: "small-solar-array",
      displayName: "Small Solar Array Blueprint",
      outputItemType: "module",
      outputModuleType: "small-solar-array",
      outputModuleId: "local_small_solar_array_1",
      totalTicks: 180,
      remainingTicks: 180,
      startedAtTick: 0,
      inputs: {
        ferrite: 90,
        "silicate-glass": 45,
        "conductive-ore": 18,
      },
      runtimeAttributes: {
        health: 100,
        status: "online",
        powerGenerationKw: 12,
      },
      capabilities: ["solar-generation"],
    });
  });

  test("cancels a construction job without refunding inventory", () => {
    const state = createState();
    startConstruction(state, smallSolarArrayBlueprint);

    const result = cancelConstruction(state, state.modules?.[0] as ModuleRecord);

    expect(result.facilityId).toBe("habitat_123_workshop_fabricator_1");
    expect(state.inventory).toEqual({
      ferrite: 30,
      "silicate-glass": 15,
      "conductive-ore": 12,
    });
    expect(state.modules?.[0].runtimeAttributes.status).toBe("idle");
    expect(state.modules?.[0].runtimeAttributes.constructionJob).toBeUndefined();
    expect(state.modules).toHaveLength(3);
  });
});

describe("construction tick integration", () => {
  test("decrements remaining ticks and creates the output module when the job completes", () => {
    const state = createState();
    startConstruction(state, smallSolarArrayBlueprint);

    const partialResult = advanceConstructionJobs(state, 60);

    expect(partialResult.completedModules).toEqual([]);
    expect(state.modules?.[0].runtimeAttributes.constructionJob).toMatchObject({
      remainingTicks: 120,
    });
    expect(state.modules?.[0].runtimeAttributes.status).toBe("active");

    const completionResult = advanceConstructionJobs(state, 120);

    expect(completionResult.completedModules).toHaveLength(1);
    expect(completionResult.completedModules[0]).toMatchObject({
      id: "local_small_solar_array_1",
      blueprintId: "small-solar-array",
      displayName: "Small Solar Array",
      runtimeAttributes: {
        health: 100,
        status: "online",
        powerGenerationKw: 12,
      },
      capabilities: ["solar-generation"],
    });
    expect(state.modules?.[0].runtimeAttributes.status).toBe("idle");
    expect(state.modules?.[0].runtimeAttributes.constructionJob).toBeUndefined();
    expect(state.modules).toHaveLength(4);
  });

  test("formats active construction jobs for status output", () => {
    const state = createState();
    startConstruction(state, smallSolarArrayBlueprint);

    expect(formatConstructionStatus(state.modules ?? [])).toBe(
      [
        "Facility             Blueprint          Remaining Ticks  Output",
        "-------------------  -----------------  ---------------  ------",
        "Workshop Fabricator  small-solar-array  180              module",
      ].join("\n"),
    );
  });
});
