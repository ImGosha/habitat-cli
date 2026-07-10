import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { LocalState } from "./local-state.js";
import { SqliteLocalStateStore } from "./local-state-storage.js";

const tempPaths = new Set<string>();

afterEach(() => {
  for (const path of tempPaths) {
    rmSync(path, { force: true, recursive: true });
  }

  tempPaths.clear();
});

function createTempDir(name: string): string {
  const path = join(tmpdir(), `habitat-cli-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(path, { recursive: true });
  tempPaths.add(path);
  return path;
}

function exampleState(): LocalState {
  return {
    kepler: {
      baseUrl: "https://planet.turingguild.com",
      displayName: "Artemis Ridge",
      habitatUuid: "uuid-1",
      habitatId: "habitat_1",
      starterModules: [
        {
          id: "habitat_1_command_module_1",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "active",
            health: 100,
          },
          capabilities: ["habitat-command"],
        },
      ],
      blueprints: [
        {
          id: "blueprint_1",
          blueprintId: "small-solar-array",
          displayName: "Small Solar Array",
          description: "A small solar array.",
          output: {
            itemType: "module",
            moduleType: "small-solar-array",
          },
          buildTicks: 180,
          prerequisites: [],
          inputs: {
            ferrite: 90,
          },
          runtimeAttributes: {
            powerGenerationKw: 12,
          },
          capabilities: ["solar-generation"],
        },
      ],
    },
    inventory: {
      ferrite: 210,
      "silicate-glass": 105,
    },
    modules: [
      {
        id: "habitat_1_basic_battery_1",
        blueprintId: "basic-battery",
        displayName: "Basic Battery",
        connectedTo: [],
        runtimeAttributes: {
          status: "online",
          currentEnergyKwh: 498.9,
          energyStorageKwh: 500,
        },
        capabilities: ["power-storage"],
      },
    ],
    simulation: {
      currentTick: 260,
      lastTickAt: "2026-07-09T19:39:00.508Z",
      lastPowerDrawKw: 16,
      lastEnergyRequestedKwh: 0.004444,
      lastEnergyDrainedKwh: 0.004444,
      lastPowerShortfallKwh: 0,
    },
  };
}

describe("sqlite local state store", () => {
  test("round-trips local habitat state through habitat.sqlite", () => {
    const dir = createTempDir("roundtrip");
    const dbPath = join(dir, "habitat.sqlite");
    const store = new SqliteLocalStateStore(dbPath);

    store.writeState(exampleState());
    const loaded = store.readState();
    store.close();

    expect(existsSync(dbPath)).toBe(true);
    expect(loaded).toEqual(exampleState());
  });

  test("does not read legacy habitat.json when the sqlite database is missing", () => {
    const dir = createTempDir("no-json-fallback");
    const dbPath = join(dir, "habitat.sqlite");
    const legacyJsonPath = join(dir, "habitat.json");
    const store = new SqliteLocalStateStore(dbPath);

    writeFileSync(legacyJsonPath, JSON.stringify(exampleState(), null, 2));

    const loaded = store.readState();
    store.close();

    expect(loaded).toEqual({});
    expect(existsSync(dbPath)).toBe(true);
  });
});
