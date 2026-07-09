import { describe, expect, test } from "bun:test";
import type { ModuleRecord } from "./modules.js";
import {
  applyPowerTick,
  applySolarCharging,
  calculateTotalPowerDrawKw,
  findPrimaryBattery,
  formatModulePowerStatusTable,
  getModulePowerDrawKw,
  type PowerTickState,
  runPowerSimulation,
} from "./power.js";

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

describe("power draw", () => {
  test("uses object-style powerDrawKw for the module status", () => {
    const module = moduleRecord({
      runtimeAttributes: {
        status: "active",
        powerDrawKw: {
          offline: 0,
          idle: 1,
          active: 5,
        },
      },
    });

    expect(getModulePowerDrawKw(module)).toBe(5);
  });

  test("uses numeric powerDrawKw directly", () => {
    const module = moduleRecord({
      runtimeAttributes: {
        status: "active",
        powerDrawKw: 2.5,
      },
    });

    expect(getModulePowerDrawKw(module)).toBe(2.5);
  });

  test("treats missing or invalid powerDrawKw as zero", () => {
    expect(getModulePowerDrawKw(moduleRecord({ runtimeAttributes: {} }))).toBe(0);
    expect(getModulePowerDrawKw(moduleRecord({ runtimeAttributes: { powerDrawKw: "a lot" } }))).toBe(0);
    expect(
      getModulePowerDrawKw(
        moduleRecord({
          runtimeAttributes: {
            status: "active",
            powerDrawKw: {
              active: "too much",
            },
          },
        }),
      ),
    ).toBe(0);
  });

  test("calculates total power draw across modules", () => {
    const modules = [
      moduleRecord({ runtimeAttributes: { powerDrawKw: 2 } }),
      moduleRecord({ runtimeAttributes: { status: "idle", powerDrawKw: { idle: 3 } } }),
    ];

    expect(calculateTotalPowerDrawKw(modules)).toBe(5);
  });
});

describe("battery drain", () => {
  test("finds the first power-storage module as the primary battery", () => {
    const nonBattery = moduleRecord({ id: "not_battery" });
    const battery = moduleRecord({
      id: "battery_1",
      capabilities: ["power-storage"],
      runtimeAttributes: {
        currentEnergyKwh: 10,
      },
    });

    expect(findPrimaryBattery([nonBattery, battery])).toBe(battery);
  });

  test("converts ticks to kWh and drains the primary battery", () => {
    const state: PowerTickState = {
      modules: [
        moduleRecord({ runtimeAttributes: { powerDrawKw: 2 } }),
        moduleRecord({
          id: "battery_1",
          capabilities: ["power-storage"],
          runtimeAttributes: {
            currentEnergyKwh: 10,
            powerDrawKw: 0,
          },
        }),
      ],
    };

    const result = applyPowerTick(state, 1800, new Date("2026-07-07T00:00:00.000Z"));

    expect(result.energyRequestedKwh).toBeCloseTo(1, 10);
    expect(result.energyDrainedKwh).toBeCloseTo(1, 10);
    expect(result.powerShortfallKwh).toBe(0);
    expect(result.currentTick).toBe(1800);
    expect(state.modules![1].runtimeAttributes.currentEnergyKwh).toBe(9);
    expect(state.simulation).toEqual({
      currentTick: 1800,
      lastTickAt: "2026-07-07T00:00:00.000Z",
      lastPowerDrawKw: 2,
      lastEnergyRequestedKwh: 1,
      lastEnergyDrainedKwh: 1,
      lastPowerShortfallKwh: 0,
    });
  });

  test("clamps battery energy at zero and reports shortfall", () => {
    const state: PowerTickState = {
      simulation: {
        currentTick: 10,
      },
      modules: [
        moduleRecord({ runtimeAttributes: { powerDrawKw: 4 } }),
        moduleRecord({
          id: "battery_1",
          capabilities: ["power-storage"],
          runtimeAttributes: {
            currentEnergyKwh: 1,
            powerDrawKw: 0,
          },
        }),
      ],
    };

    const result = applyPowerTick(state, 1800, new Date("2026-07-07T00:00:00.000Z"));

    expect(result.energyRequestedKwh).toBe(2);
    expect(result.energyDrainedKwh).toBe(1);
    expect(result.powerShortfallKwh).toBe(1);
    expect(result.currentTick).toBe(1810);
    expect(state.modules![1].runtimeAttributes.currentEnergyKwh).toBe(0);
  });
});

describe("solar charging", () => {
  test("charges the first online battery from all online solar modules", () => {
    const state: PowerTickState = {
      modules: [
        moduleRecord({
          id: "battery_offline",
          capabilities: ["power-storage"],
          runtimeAttributes: {
            status: "offline",
            currentEnergyKwh: 5,
            energyStorageKwh: 10,
          },
        }),
        moduleRecord({
          id: "battery_online",
          capabilities: ["power-storage"],
          runtimeAttributes: {
            status: "online",
            currentEnergyKwh: 2,
            energyStorageKwh: 5,
          },
        }),
        moduleRecord({
          id: "solar_1",
          capabilities: ["solar-generation"],
          runtimeAttributes: {
            status: "online",
            powerGenerationKw: 12,
          },
        }),
        moduleRecord({
          id: "solar_2",
          capabilities: ["solar-generation"],
          runtimeAttributes: {
            status: "online",
            powerGenerationKw: 6,
          },
        }),
        moduleRecord({
          id: "solar_idle",
          capabilities: ["solar-generation"],
          runtimeAttributes: {
            status: "idle",
            powerGenerationKw: 50,
          },
        }),
      ],
    };

    const result = applySolarCharging(state, 3600, { wPerM2: 900, condition: "clear" });

    expect(result).toEqual({
      batteryId: "battery_online",
      generatedKwh: 9,
      batteryEnergyBeforeKwh: 2,
      batteryEnergyAfterKwh: 5,
      noChargeReason: undefined,
      solarModuleCount: 2,
      irradiance: { wPerM2: 900, condition: "clear" },
    });
    expect(state.modules![1].runtimeAttributes.currentEnergyKwh).toBe(5);
  });

  test("reports why no charging occurred when no online solar modules are available", () => {
    const state: PowerTickState = {
      modules: [
        moduleRecord({
          id: "battery_online",
          capabilities: ["power-storage"],
          runtimeAttributes: {
            status: "online",
            currentEnergyKwh: 2,
            energyStorageKwh: 5,
          },
        }),
        moduleRecord({
          id: "solar_idle",
          capabilities: ["solar-generation"],
          runtimeAttributes: {
            status: "idle",
            powerGenerationKw: 12,
          },
        }),
      ],
    };

    const result = applySolarCharging(state, 60, { wPerM2: 900, condition: "clear" });

    expect(result).toEqual({
      batteryId: undefined,
      generatedKwh: 0,
      batteryEnergyBeforeKwh: undefined,
      batteryEnergyAfterKwh: undefined,
      noChargeReason: "No online solar modules were available for charging.",
      solarModuleCount: 0,
      irradiance: { wPerM2: 900, condition: "clear" },
    });
    expect(state.modules![0].runtimeAttributes.currentEnergyKwh).toBe(2);
  });

  test("reports why no charging occurred when the battery is not online", () => {
    const state: PowerTickState = {
      modules: [
        moduleRecord({
          id: "battery_idle",
          capabilities: ["power-storage"],
          runtimeAttributes: {
            status: "idle",
            currentEnergyKwh: 2,
            energyStorageKwh: 5,
          },
        }),
        moduleRecord({
          id: "solar_online",
          capabilities: ["solar-generation"],
          runtimeAttributes: {
            status: "online",
            powerGenerationKw: 12,
          },
        }),
      ],
    };

    const result = applySolarCharging(state, 60, { wPerM2: 900, condition: "clear" });

    expect(result).toEqual({
      batteryId: undefined,
      generatedKwh: 0,
      batteryEnergyBeforeKwh: undefined,
      batteryEnergyAfterKwh: undefined,
      noChargeReason: "No online battery was available for solar charging.",
      solarModuleCount: 1,
      irradiance: { wPerM2: 900, condition: "clear" },
    });
  });

  test("continues the tick simulation when solar irradiance cannot be retrieved", async () => {
    const state: PowerTickState = {
      modules: [
        moduleRecord({ runtimeAttributes: { powerDrawKw: 2 } }),
        moduleRecord({
          id: "battery_1",
          capabilities: ["power-storage"],
          runtimeAttributes: {
            status: "active",
            currentEnergyKwh: 10,
            powerDrawKw: 0,
          },
        }),
        moduleRecord({
          id: "solar_1",
          capabilities: ["solar-generation"],
          runtimeAttributes: {
            status: "online",
            powerGenerationKw: 12,
          },
        }),
      ],
    };

    const result = await runPowerSimulation(
      state,
      1800,
      async () => {
        throw new Error("network down");
      },
      new Date("2026-07-07T00:00:00.000Z"),
    );

    expect(result.energyRequestedKwh).toBeCloseTo(1, 10);
    expect(result.energyDrainedKwh).toBeCloseTo(1, 10);
    expect(result.solarGeneratedKwh).toBe(0);
    expect(result.solarNoChargeReasons).toEqual([
      "No solar charging occurred because the solar irradiance could not be retrieved.",
    ]);
    expect(state.modules![1].runtimeAttributes.currentEnergyKwh).toBeCloseTo(9, 10);
  });
});

describe("module power status table", () => {
  test("formats module state, current power draw, total draw, and one-tick energy cost", () => {
    const modules = [
      moduleRecord({
        displayName: "Command Module",
        runtimeAttributes: {
          status: "active",
          powerDrawKw: {
            idle: 1,
            active: 2,
          },
        },
      }),
      moduleRecord({
        displayName: "Workshop",
        runtimeAttributes: {
          status: "idle",
          powerDrawKw: {
            idle: 3,
            active: 8,
          },
        },
      }),
    ];

    expect(formatModulePowerStatusTable(modules)).toBe(
      [
        "Module          State   Power Draw",
        "--------------  ------  ----------",
        "Command Module  active  2 kW",
        "Workshop        idle    3 kW",
        "",
        "Metric                    Value",
        "------------------------  ------------",
        "Total Current Power Draw  5 kW",
        "Energy Cost For One Tick  0.001389 kWh",
      ].join("\n"),
    );
  });
});
