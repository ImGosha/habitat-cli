import { describe, expect, test } from "bun:test";
import type { ModuleRecord } from "./modules.js";
import {
  applyPowerTick,
  calculateTotalPowerDrawKw,
  findPrimaryBattery,
  formatModulePowerStatusTable,
  getModulePowerDrawKw,
  type PowerTickState,
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

    expect(result.energyRequestedKwh).toBe(1);
    expect(result.energyDrainedKwh).toBe(1);
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
        "Total Current Power Draw: 5 kW",
        "Energy Cost For One Tick: 0.001389 kWh",
      ].join("\n"),
    );
  });
});
