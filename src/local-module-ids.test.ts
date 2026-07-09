import { describe, expect, test } from "bun:test";
import type { ModuleRecord } from "./modules.js";
import { createNextLocalModuleId } from "./local-module-ids.js";

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

describe("local module IDs", () => {
  test("creates the first numbered local module id for a blueprint", () => {
    expect(createNextLocalModuleId([], "small-solar-array")).toBe("local_small_solar_array_1");
  });

  test("increments based on existing local modules of the same blueprint", () => {
    const modules = [
      moduleRecord({ id: "local_small_solar_array_1" }),
      moduleRecord({ id: "local_small_solar_array_2" }),
      moduleRecord({ id: "local_basic_battery_1" }),
    ];

    expect(createNextLocalModuleId(modules, "small-solar-array")).toBe("local_small_solar_array_3");
  });

  test("skips ids already reserved by active construction jobs", () => {
    const modules = [
      moduleRecord({
        id: "habitat_123_workshop_fabricator_1",
        runtimeAttributes: {
          constructionJob: {
            outputModuleId: "local_small_solar_array_2",
          },
        },
      }),
      moduleRecord({ id: "local_small_solar_array_1" }),
    ];

    expect(createNextLocalModuleId(modules, "small-solar-array")).toBe("local_small_solar_array_3");
  });
});
