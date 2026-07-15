import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHabitatApiApp } from "./habitat-api.js";
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
  const path = join(tmpdir(), `habitat-api-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(path, { recursive: true });
  tempPaths.add(path);
  return path;
}

function exampleState(): LocalState {
  return {
    kepler: {
      baseUrl: "https://planet.turingguild.com",
      displayName: "Artemis Ridge",
      habitatUuid: "uuid-123",
      habitatId: "habitat_123",
      contracts: {
        alerts: {
          schemaVersion: "1.0",
          schema: {
            required: ["id", "code"],
          },
        },
      },
      starterModules: [],
      starterHumans: [],
      blueprints: [],
    },
  };
}

describe("habitat api", () => {
  test("GET /registration returns null when no registration exists", async () => {
    const dir = createTempDir("empty-registration");
    const store = new SqliteLocalStateStore(join(dir, "habitat.sqlite"));
    const app = createHabitatApiApp({ store });

    const response = await app.request("/registration");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      registration: null,
    });

    store.close();
  });

  test("GET /registration returns structured registration data", async () => {
    const dir = createTempDir("existing-registration");
    const store = new SqliteLocalStateStore(join(dir, "habitat.sqlite"));
    store.writeState(exampleState());
    const app = createHabitatApiApp({ store });

    const response = await app.request("/registration");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      registration: {
        habitatUuid: "uuid-123",
        habitatId: "habitat_123",
        displayName: "Artemis Ridge",
      },
    });

    store.close();
  });

  test("POST /registration proxies to Kepler and persists the registration", async () => {
    const dir = createTempDir("register");
    const store = new SqliteLocalStateStore(join(dir, "habitat.sqlite"));
    const logs: string[] = [];
    const app = createHabitatApiApp({
      store,
      keplerToken: "test-token",
      createUuid: () => "uuid-created-here",
      logger: (line) => logs.push(line),
      fetchImpl: async (input, init) => {
        expect(String(input)).toBe("https://planet.turingguild.com/habitats/register");
        expect(init?.method).toBe("POST");
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer test-token",
        });
        expect(init?.body).toBe(JSON.stringify({ displayName: "Artemis Ridge", habitatUuid: "uuid-created-here" }));

        return new Response(
          JSON.stringify({
            habitatId: "habitat_123",
            contracts: {
              alerts: {
                schemaVersion: "1.0",
                schema: {
                  required: ["id", "code", "status"],
                },
              },
            },
            starterModules: [
              {
                id: "habitat_123_command_module_1",
                blueprintId: "command-module",
                displayName: "Command Module",
                connectedTo: [],
                runtimeAttributes: {
                  status: "active",
                },
                capabilities: ["habitat-command"],
              },
            ],
            starterHumans: [
              {
                id: "human_1",
                displayName: "Alex Vega",
                locationModuleId: "habitat_123_command_module_1",
              },
              {
                id: "human_2",
                displayName: "Sam Carter",
                locationModuleId: "habitat_123_command_module_1",
              },
            ],
            blueprints: [
              {
                blueprintId: "small-solar-array",
                displayName: "Small Solar Array",
              },
            ],
          }),
          {
            status: 201,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      },
    });

    const response = await app.request("/registration", {
      method: "POST",
      body: JSON.stringify({ displayName: "Artemis Ridge" }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      registration: {
        displayName: "Artemis Ridge",
        habitatUuid: "uuid-created-here",
        habitatId: "habitat_123",
        starterModules: 1,
        blueprints: 1,
      },
    });
    expect(store.readState().kepler?.displayName).toBe("Artemis Ridge");
    expect(store.readState().kepler?.starterHumans).toEqual([
      {
        id: "human_1",
        displayName: "Alex Vega",
        locationModuleId: "habitat_123_command_module_1",
      },
      {
        id: "human_2",
        displayName: "Sam Carter",
        locationModuleId: "habitat_123_command_module_1",
      },
    ]);
    expect(store.readState().kepler?.contracts).toEqual({
      alerts: {
        schemaVersion: "1.0",
        schema: {
          required: ["id", "code", "status"],
        },
      },
    });
    expect(store.readState().modules?.length).toBe(1);
    expect(store.readState().humans).toEqual([
      {
        id: "human_1",
        displayName: "Alex Vega",
        locationModuleId: "habitat_123_command_module_1",
      },
      {
        id: "human_2",
        displayName: "Sam Carter",
        locationModuleId: "habitat_123_command_module_1",
      },
    ]);
    expect(logs).toEqual([
      "[kepler] POST /habitats/register -> 201",
      "[habitat-api] POST /registration -> 1 starter modules, 2 starter humans",
    ]);

    store.close();
  });

  test("GET /status refreshes remote registration details through Kepler", async () => {
    const dir = createTempDir("status");
    const store = new SqliteLocalStateStore(join(dir, "habitat.sqlite"));
    store.writeState(exampleState());
    const logs: string[] = [];
    const app = createHabitatApiApp({
      store,
      keplerToken: "test-token",
      logger: (line) => logs.push(line),
      fetchImpl: async (input, init) => {
        expect(String(input)).toBe("https://planet.turingguild.com/habitats/habitat_123/registration");
        expect(init?.method).toBe("GET");
        return new Response(
          JSON.stringify({
            habitat: {
              id: "habitat_123",
              habitatSlug: "artemis-ridge",
              displayName: "Artemis Ridge",
              catalogVersion: "kepler-442b-v1",
              status: "registered",
              lastSeenAt: "2026-07-10T00:00:00.000Z",
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      },
    });

    const response = await app.request("/status");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      registration: {
        displayName: "Artemis Ridge",
        habitatUuid: "uuid-123",
        habitatId: "habitat_123",
        baseUrl: "https://planet.turingguild.com",
        habitatSlug: "artemis-ridge",
        status: "registered",
        catalogVersion: "kepler-442b-v1",
        lastSeenAt: "2026-07-10T00:00:00.000Z",
        starterModules: 0,
        blueprints: 0,
        localModules: 0,
      },
    });
    expect(logs).toEqual([
      "[kepler] GET /habitats/habitat_123/registration -> 200",
      "[habitat-api] GET /status -> registered",
    ]);

    store.close();
  });

  test("DELETE /registration unregisters remotely and clears local registration", async () => {
    const dir = createTempDir("unregister");
    const store = new SqliteLocalStateStore(join(dir, "habitat.sqlite"));
    store.writeState(exampleState());
    const logs: string[] = [];
    const app = createHabitatApiApp({
      store,
      keplerToken: "test-token",
      logger: (line) => logs.push(line),
      fetchImpl: async (input, init) => {
        expect(String(input)).toBe("https://planet.turingguild.com/habitats/habitat_123");
        expect(init?.method).toBe("DELETE");
        return new Response(null, {
          status: 204,
        });
      },
    });

    const response = await app.request("/registration", {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      registration: {
        displayName: "Artemis Ridge",
        status: "Removed from Kepler",
      },
    });
    expect(store.readState().kepler).toBeUndefined();
    expect(logs).toEqual([
      "[kepler] DELETE /habitats/habitat_123 -> 204",
      "[habitat-api] DELETE /registration -> removed",
    ]);

    store.close();
  });

  test("GET /catalog/blueprints proxies the Kepler blueprint catalog", async () => {
    const dir = createTempDir("blueprint-list");
    const store = new SqliteLocalStateStore(join(dir, "habitat.sqlite"));
    const logs: string[] = [];
    const app = createHabitatApiApp({
      store,
      keplerToken: "test-token",
      logger: (line) => logs.push(line),
      fetchImpl: async (input, init) => {
        expect(String(input)).toBe("https://planet.turingguild.com/catalog/blueprints");
        expect(init?.method).toBe("GET");
        return new Response(
          JSON.stringify({
            blueprints: [
              {
                blueprintId: "small-solar-array",
                displayName: "Small Solar Array",
                buildTicks: 180,
              },
            ],
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      },
    });

    const response = await app.request("/catalog/blueprints");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      blueprints: [
        {
          blueprintId: "small-solar-array",
          displayName: "Small Solar Array",
          buildTicks: 180,
        },
      ],
    });
    expect(logs).toEqual([
      "[kepler] GET /catalog/blueprints -> 200",
      "[habitat-api] GET /catalog/blueprints -> 1 blueprints",
    ]);

    store.close();
  });

  test("GET /catalog/blueprints/:blueprintId proxies one blueprint", async () => {
    const dir = createTempDir("blueprint-show");
    const store = new SqliteLocalStateStore(join(dir, "habitat.sqlite"));
    const logs: string[] = [];
    const app = createHabitatApiApp({
      store,
      keplerToken: "test-token",
      logger: (line) => logs.push(line),
      fetchImpl: async (input, init) => {
        expect(String(input)).toBe("https://planet.turingguild.com/catalog/blueprints/small-solar-array");
        expect(init?.method).toBe("GET");
        return new Response(
          JSON.stringify({
            blueprint: {
              blueprintId: "small-solar-array",
              displayName: "Small Solar Array",
              description: "A solar array.",
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      },
    });

    const response = await app.request("/catalog/blueprints/small-solar-array");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      blueprint: {
        blueprintId: "small-solar-array",
        displayName: "Small Solar Array",
        description: "A solar array.",
      },
    });
    expect(logs).toEqual([
      "[kepler] GET /catalog/blueprints/small-solar-array -> 200",
      "[habitat-api] GET /catalog/blueprints/small-solar-array -> found",
    ]);

    store.close();
  });

  test("GET /catalog/resources proxies the Kepler resource catalog", async () => {
    const dir = createTempDir("resource-list");
    const store = new SqliteLocalStateStore(join(dir, "habitat.sqlite"));
    const logs: string[] = [];
    const app = createHabitatApiApp({
      store,
      keplerToken: "test-token",
      logger: (line) => logs.push(line),
      fetchImpl: async (input, init) => {
        expect(String(input)).toBe("https://planet.turingguild.com/catalog/resources");
        expect(init?.method).toBe("GET");
        return new Response(
          JSON.stringify({
            resources: [
              {
                resourceType: "ferrite",
                displayName: "Ferrite",
                kind: "ore",
                rarity: "common",
              },
            ],
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      },
    });

    const response = await app.request("/catalog/resources");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      resources: [
        {
          resourceType: "ferrite",
          displayName: "Ferrite",
          kind: "ore",
          rarity: "common",
        },
      ],
    });
    expect(logs).toEqual([
      "[kepler] GET /catalog/resources -> 200",
      "[habitat-api] GET /catalog/resources -> 1 resources",
    ]);

    store.close();
  });

  test("GET /solar/irradiance proxies Kepler solar data", async () => {
    const dir = createTempDir("solar-status");
    const store = new SqliteLocalStateStore(join(dir, "habitat.sqlite"));
    const logs: string[] = [];
    const app = createHabitatApiApp({
      store,
      keplerToken: "test-token",
      logger: (line) => logs.push(line),
      fetchImpl: async (input, init) => {
        expect(String(input)).toBe("https://planet.turingguild.com/world/solar-irradiance");
        expect(init?.method).toBe("GET");
        return new Response(
          JSON.stringify({
            solarIrradiance: {
              wPerM2: 540,
              condition: "dusty",
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      },
    });

    const response = await app.request("/solar/irradiance");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      solarIrradiance: {
        wPerM2: 540,
        condition: "dusty",
      },
    });
    expect(logs).toEqual([
      "[kepler] GET /world/solar-irradiance -> 200",
      "[habitat-api] GET /solar/irradiance -> 540 W/m^2",
    ]);

    store.close();
  });

  test("GET /scan uses the deployed EVA position, supplies habitatId, and returns the Kepler scan payload unchanged", async () => {
    const dir = createTempDir("scan-route");
    const store = new SqliteLocalStateStore(join(dir, "habitat.sqlite"));
    store.writeState({
      ...exampleState(),
      eva: {
        deployedHumanId: "human_1",
        suitportModuleId: "basic_suitport_1",
        position: { x: 1, y: 0 },
        carriedResources: [],
        carryCapacityKg: 20,
      },
    });
    const logs: string[] = [];
    const app = createHabitatApiApp({
      store,
      keplerToken: "test-token",
      logger: (line) => logs.push(line),
      fetchImpl: async (input, init) => {
        expect(String(input)).toBe(
          "https://planet.turingguild.com/world/scan?habitatId=habitat_123&x=1&y=0&sensorStrength=60&radiusTiles=1",
        );
        expect(init?.method).toBe("GET");
        return new Response(
          JSON.stringify({
            scan: {
              modelVersion: "scan-v1",
              origin: {
                x: 1,
                y: 0,
              },
              sensorStrength: 60,
              radiusTiles: 1,
              tiles: [
                {
                  x: 1,
                  y: 0,
                  terrain: "flat",
                  distanceTiles: 0,
                  probabilities: [
                    { resourceType: "ferrite", probabilityPct: 63.5 },
                    { resourceType: null, probabilityPct: 36.5 },
                  ],
                  topCandidate: {
                    resourceType: "ferrite",
                    probabilityPct: 63.5,
                  },
                  quantityEstimate: {
                    resourceType: "ferrite",
                    unit: "kg",
                    estimatedKg: 184,
                    minimumKg: 160,
                    maximumKg: 210,
                    exact: false,
                  },
                },
              ],
            },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      },
    });

    const response = await app.request("/scan?strength=60&radius=1");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      scan: {
        modelVersion: "scan-v1",
        origin: {
          x: 1,
          y: 0,
        },
        sensorStrength: 60,
        radiusTiles: 1,
        tiles: [
          {
            x: 1,
            y: 0,
            terrain: "flat",
            distanceTiles: 0,
            probabilities: [
              { resourceType: "ferrite", probabilityPct: 63.5 },
              { resourceType: null, probabilityPct: 36.5 },
            ],
            topCandidate: {
              resourceType: "ferrite",
              probabilityPct: 63.5,
            },
            quantityEstimate: {
              resourceType: "ferrite",
              unit: "kg",
              estimatedKg: 184,
              minimumKg: 160,
              maximumKg: 210,
              exact: false,
            },
          },
        ],
      },
    });
    expect(logs).toEqual([
      "[kepler] GET /world/scan?habitatId=habitat_123&x=1&y=0&sensorStrength=60&radiusTiles=1 -> 200",
      "[habitat-api] GET /scan -> 1 tiles",
    ]);

    store.close();
  });

  test("GET /scan returns clear validation errors", async () => {
    const dir = createTempDir("scan-validation");
    const store = new SqliteLocalStateStore(join(dir, "habitat.sqlite"));
    store.writeState({
      ...exampleState(),
      eva: {
        deployedHumanId: "human_1",
        suitportModuleId: "basic_suitport_1",
        position: { x: 0, y: 0 },
        carriedResources: [],
        carryCapacityKg: 20,
      },
    });
    const app = createHabitatApiApp({
      store,
      keplerToken: "test-token",
    });

    const badStrength = await app.request("/scan?strength=101&radius=0");
    expect(badStrength.status).toBe(400);
    expect(await badStrength.json()).toEqual({
      error: {
        message: "strength must be an integer from 0 through 100.",
      },
    });

    const badRadius = await app.request("/scan?strength=60&radius=6");
    expect(badRadius.status).toBe(400);
    expect(await badRadius.json()).toEqual({
      error: {
        message: "radius must be an integer from 0 through 5.",
      },
    });

    store.close();
  });

  test("GET /scan requires a deployed explorer", async () => {
    const dir = createTempDir("scan-no-explorer");
    const store = new SqliteLocalStateStore(join(dir, "habitat.sqlite"));
    store.writeState(exampleState());
    const app = createHabitatApiApp({
      store,
      keplerToken: "test-token",
    });

    const response = await app.request("/scan?strength=60&radius=0");

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        message: "No human is currently deployed for EVA.",
      },
    });

    store.close();
  });

  test("module routes read and write local module state", async () => {
    const dir = createTempDir("module-routes");
    const store = new SqliteLocalStateStore(join(dir, "habitat.sqlite"));
    store.writeState({
      kepler: {
        baseUrl: "https://planet.turingguild.com",
        displayName: "Artemis Ridge",
        habitatUuid: "uuid-123",
        habitatId: "habitat_123",
        starterHumans: [],
        starterModules: [],
        blueprints: [
          {
            blueprintId: "small-solar-array",
            displayName: "Small Solar Array",
            output: {
              itemType: "module",
              moduleType: "small-solar-array",
            },
            runtimeAttributes: {
              status: "online",
              health: 100,
              powerGenerationKw: 12,
            },
            capabilities: ["solar-generation"],
          },
        ],
      },
      modules: [
        {
          id: "local_small_solar_array_1",
          blueprintId: "small-solar-array",
          displayName: "Solar A",
          connectedTo: [],
          runtimeAttributes: {
            status: "online",
            health: 100,
          },
          capabilities: ["solar-generation"],
        },
      ],
    });
    const logs: string[] = [];
    const app = createHabitatApiApp({
      store,
      keplerToken: "test-token",
      logger: (line) => logs.push(line),
    });

    const listResponse = await app.request("/modules");
    expect(listResponse.status).toBe(200);
    expect((await listResponse.json()).modules).toHaveLength(1);

    const showResponse = await app.request("/modules/small_solar_array_1");
    expect(showResponse.status).toBe(200);
    expect((await showResponse.json()).module.displayName).toBe("Solar A");

    const createResponse = await app.request("/modules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        blueprintId: "small-solar-array",
        name: "Solar B",
      }),
    });
    expect(createResponse.status).toBe(201);
    expect((await createResponse.json()).module.id).toBe("local_small_solar_array_2");

    const updateResponse = await app.request("/modules/small_solar_array_1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Solar A Prime",
        health: 95,
      }),
    });
    expect(updateResponse.status).toBe(200);
    expect((await updateResponse.json()).module.displayName).toBe("Solar A Prime");

    const deleteResponse = await app.request("/modules/small_solar_array_2", {
      method: "DELETE",
    });
    expect(deleteResponse.status).toBe(200);
    expect((await deleteResponse.json()).module.displayName).toBe("Solar B");
    expect(store.readState().modules).toHaveLength(1);
    expect(logs).toEqual([
      "[habitat-api] GET /modules -> 1 modules",
      "[habitat-api] GET /modules/small_solar_array_1 -> found",
      "[habitat-api] POST /modules -> created local_small_solar_array_2",
      "[habitat-api] PATCH /modules/small_solar_array_1 -> updated",
      "[habitat-api] DELETE /modules/small_solar_array_2 -> deleted",
    ]);

    store.close();
  });

  test("inventory routes read and mutate local inventory state", async () => {
    const dir = createTempDir("inventory-routes");
    const store = new SqliteLocalStateStore(join(dir, "habitat.sqlite"));
    store.writeState({
      inventory: {
        ferrite: 10,
      },
    });
    const logs: string[] = [];
    const app = createHabitatApiApp({
      store,
      keplerToken: "test-token",
      logger: (line) => logs.push(line),
    });

    const listResponse = await app.request("/inventory");
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toEqual({
      inventory: {
        ferrite: 10,
      },
    });

    const addResponse = await app.request("/inventory/ferrite", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delta: 5 }),
    });
    expect(addResponse.status).toBe(200);
    expect(await addResponse.json()).toEqual({
      resourceId: "ferrite",
      previousAmount: 10,
      newAmount: 15,
    });

    const removeResponse = await app.request("/inventory/ferrite", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delta: -3 }),
    });
    expect(removeResponse.status).toBe(200);
    expect(await removeResponse.json()).toEqual({
      resourceId: "ferrite",
      previousAmount: 15,
      newAmount: 12,
    });
    expect(store.readState().inventory).toEqual({
      ferrite: 12,
    });
    expect(logs).toEqual([
      "[habitat-api] GET /inventory -> 1 resources",
      "[habitat-api] PUT /inventory/ferrite -> 10 to 15",
      "[habitat-api] PUT /inventory/ferrite -> 15 to 12",
    ]);

    store.close();
  });

  test("human routes list persisted humans and move them between valid modules", async () => {
    const dir = createTempDir("human-routes");
    const store = new SqliteLocalStateStore(join(dir, "habitat.sqlite"));
    store.writeState({
      modules: [
        {
          id: "command_module_1",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "active",
            crewCapacity: 2,
          },
          capabilities: ["habitat-command"],
        },
        {
          id: "basic_suitport_1",
          blueprintId: "basic-suitport",
          displayName: "Basic Suitport",
          connectedTo: [],
          runtimeAttributes: {
            status: "online",
            crewCapacity: 1,
          },
          capabilities: ["limited-eva", "suitport-access"],
        },
      ],
      humans: [
        {
          id: "human_1",
          displayName: "Alex Vega",
          locationModuleId: "command_module_1",
        },
        {
          id: "human_2",
          displayName: "Sam Carter",
          locationModuleId: "command_module_1",
        },
      ],
    });
    const logs: string[] = [];
    const app = createHabitatApiApp({
      store,
      keplerToken: "test-token",
      logger: (line) => logs.push(line),
    });

    const listResponse = await app.request("/humans");
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toEqual({
      humans: [
        {
          id: "human_1",
          displayName: "Alex Vega",
          locationModuleId: "command_module_1",
        },
        {
          id: "human_2",
          displayName: "Sam Carter",
          locationModuleId: "command_module_1",
        },
      ],
    });

    const moveResponse = await app.request("/humans/human_1/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        destinationModuleId: "basic_suitport_1",
      }),
    });
    expect(moveResponse.status).toBe(200);
    expect(await moveResponse.json()).toEqual({
      human: {
        id: "human_1",
        displayName: "Alex Vega",
        locationModuleId: "basic_suitport_1",
      },
    });
    expect(store.readState().humans).toEqual([
      {
        id: "human_1",
        displayName: "Alex Vega",
        locationModuleId: "basic_suitport_1",
      },
      {
        id: "human_2",
        displayName: "Sam Carter",
        locationModuleId: "command_module_1",
      },
    ]);
    expect(logs).toEqual([
      "[habitat-api] GET /humans -> 2 humans",
      "[habitat-api] POST /humans/human_1/move -> basic_suitport_1",
    ]);

    store.close();
  });

  test("human move rejects missing humans, missing modules, and full modules", async () => {
    const dir = createTempDir("human-move-rejections");
    const store = new SqliteLocalStateStore(join(dir, "habitat.sqlite"));
    store.writeState({
      modules: [
        {
          id: "command_module_1",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "active",
            crewCapacity: 2,
          },
          capabilities: ["habitat-command"],
        },
        {
          id: "basic_suitport_1",
          blueprintId: "basic-suitport",
          displayName: "Basic Suitport",
          connectedTo: [],
          runtimeAttributes: {
            status: "online",
            crewCapacity: 1,
          },
          capabilities: ["limited-eva", "suitport-access"],
        },
      ],
      humans: [
        {
          id: "human_1",
          displayName: "Alex Vega",
          locationModuleId: "command_module_1",
        },
        {
          id: "human_2",
          displayName: "Sam Carter",
          locationModuleId: "basic_suitport_1",
        },
      ],
    });
    const app = createHabitatApiApp({
      store,
      keplerToken: "test-token",
    });

    const missingHumanResponse = await app.request("/humans/missing_human/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        destinationModuleId: "command_module_1",
      }),
    });
    expect(missingHumanResponse.status).toBe(404);
    expect(await missingHumanResponse.json()).toEqual({
      error: {
        message: 'Human "missing_human" was not found.',
      },
    });

    const missingModuleResponse = await app.request("/humans/human_1/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        destinationModuleId: "missing_module",
      }),
    });
    expect(missingModuleResponse.status).toBe(404);
    expect(await missingModuleResponse.json()).toEqual({
      error: {
        message: 'Module "missing_module" was not found.',
      },
    });

    const fullModuleResponse = await app.request("/humans/human_1/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        destinationModuleId: "basic_suitport_1",
      }),
    });
    expect(fullModuleResponse.status).toBe(409);
    expect(await fullModuleResponse.json()).toEqual({
      error: {
        message: 'Module "basic_suitport_1" is already at full crew capacity.',
      },
    });
    expect(store.readState().humans).toEqual([
      {
        id: "human_1",
        displayName: "Alex Vega",
        locationModuleId: "command_module_1",
      },
      {
        id: "human_2",
        displayName: "Sam Carter",
        locationModuleId: "basic_suitport_1",
      },
    ]);

    store.close();
  });

  test("module deletion rejects occupied modules", async () => {
    const dir = createTempDir("occupied-module-delete");
    const store = new SqliteLocalStateStore(join(dir, "habitat.sqlite"));
    store.writeState({
      modules: [
        {
          id: "command_module_1",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "active",
            crewCapacity: 2,
          },
          capabilities: ["habitat-command"],
        },
      ],
      humans: [
        {
          id: "human_1",
          displayName: "Alex Vega",
          locationModuleId: "command_module_1",
        },
      ],
    });
    const app = createHabitatApiApp({
      store,
      keplerToken: "test-token",
    });

    const response = await app.request("/modules/command_module_1", {
      method: "DELETE",
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        message: 'Module "command_module_1" cannot be deleted while occupied by human "human_1".',
      },
    });
    expect(store.readState().modules).toHaveLength(1);

    store.close();
  });

  test("eva routes deploy one explorer, move one tile at a time, and report status", async () => {
    const dir = createTempDir("eva-routes");
    const store = new SqliteLocalStateStore(join(dir, "habitat.sqlite"));
    store.writeState({
      kepler: {
        baseUrl: "https://planet.turingguild.com",
        displayName: "Artemis Ridge",
        habitatUuid: "uuid-123",
        habitatId: "habitat_123",
        contracts: {
          alerts: {
            schemaVersion: "1.0",
            schema: {},
          },
        },
        starterModules: [],
        starterHumans: [],
        blueprints: [],
      },
      modules: [
        {
          id: "basic_suitport_1",
          blueprintId: "basic-suitport",
          displayName: "Basic Suitport",
          connectedTo: [],
          runtimeAttributes: {
            status: "online",
            crewCapacity: 1,
          },
          capabilities: ["limited-eva", "suitport-access"],
        },
      ],
      humans: [
        {
          id: "human_1",
          displayName: "Alex Vega",
          locationModuleId: "basic_suitport_1",
        },
      ],
    });
    const logs: string[] = [];
    const app = createHabitatApiApp({
      store,
      keplerToken: "test-token",
      logger: (line) => logs.push(line),
      fetchImpl: async (input, init) => {
        expect(String(input)).toBe("https://planet.turingguild.com/world/sectors/current?habitatId=habitat_123");
        expect(init?.method).toBe("GET");
        return new Response(
          JSON.stringify({
            sector: {
              id: "kepler-local-001",
              displayName: "Starter Sector",
              origin: { x: 0, y: 0 },
              bounds: {
                minX: -25,
                maxX: 24,
                minY: -25,
                maxY: 24,
              },
              tileSizeMeters: 100,
              supportedTerrains: ["flat"],
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    });

    const deployResponse = await app.request("/eva/deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ humanId: "human_1" }),
    });
    expect(deployResponse.status).toBe(200);
    expect(await deployResponse.json()).toEqual({
      eva: {
        deployedHumanId: "human_1",
        suitportModuleId: "basic_suitport_1",
        position: { x: 0, y: 0 },
        carriedResources: [],
        carryCapacityKg: 20,
      },
    });

    const moveResponse = await app.request("/eva/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x: 1, y: 0 }),
    });
    expect(moveResponse.status).toBe(200);
    expect(await moveResponse.json()).toEqual({
      eva: {
        deployedHumanId: "human_1",
        suitportModuleId: "basic_suitport_1",
        position: { x: 1, y: 0 },
        carriedResources: [],
        carryCapacityKg: 20,
      },
    });

    const statusResponse = await app.request("/eva");
    expect(statusResponse.status).toBe(200);
    expect(await statusResponse.json()).toEqual({
      eva: {
        deployedHumanId: "human_1",
        suitportModuleId: "basic_suitport_1",
        position: { x: 1, y: 0 },
        carriedResources: [],
        carryCapacityKg: 20,
      },
    });
    expect(logs).toEqual([
      "[kepler] GET /world/sectors/current?habitatId=habitat_123 -> 200",
      "[habitat-api] POST /eva/deploy -> human_1",
      "[kepler] GET /world/sectors/current?habitatId=habitat_123 -> 200",
      "[habitat-api] POST /eva/move -> (1, 0)",
      "[habitat-api] GET /eva -> human_1",
    ]);

    store.close();
  });

  test("eva routes reject invalid deploy, movement, and docking actions", async () => {
    const dir = createTempDir("eva-rejections");
    const store = new SqliteLocalStateStore(join(dir, "habitat.sqlite"));
    store.writeState({
      kepler: {
        baseUrl: "https://planet.turingguild.com",
        displayName: "Artemis Ridge",
        habitatUuid: "uuid-123",
        habitatId: "habitat_123",
        contracts: {
          alerts: {
            schemaVersion: "1.0",
            schema: {},
          },
        },
        starterModules: [],
        starterHumans: [],
        blueprints: [],
      },
      modules: [
        {
          id: "command_module_1",
          blueprintId: "command-module",
          displayName: "Command Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "active",
            crewCapacity: 2,
          },
          capabilities: ["habitat-command"],
        },
        {
          id: "basic_suitport_1",
          blueprintId: "basic-suitport",
          displayName: "Basic Suitport",
          connectedTo: [],
          runtimeAttributes: {
            status: "online",
            crewCapacity: 1,
          },
          capabilities: ["limited-eva", "suitport-access"],
        },
      ],
      humans: [
        {
          id: "human_1",
          displayName: "Alex Vega",
          locationModuleId: "command_module_1",
        },
      ],
    });
    const app = createHabitatApiApp({
      store,
      keplerToken: "test-token",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            sector: {
              id: "kepler-local-001",
              displayName: "Starter Sector",
              origin: { x: 0, y: 0 },
              bounds: {
                minX: -1,
                maxX: 1,
                minY: -1,
                maxY: 1,
              },
              tileSizeMeters: 100,
              supportedTerrains: ["flat"],
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
    });

    const deployResponse = await app.request("/eva/deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ humanId: "human_1" }),
    });
    expect(deployResponse.status).toBe(409);
    expect(await deployResponse.json()).toEqual({
      error: {
        message: 'Human "human_1" must be in a suitport module before EVA deployment.',
      },
    });

    store.writeState({
      ...store.readState(),
      humans: [
        {
          id: "human_1",
          displayName: "Alex Vega",
          locationModuleId: "basic_suitport_1",
        },
      ],
      eva: {
        deployedHumanId: "human_1",
        suitportModuleId: "basic_suitport_1",
        position: { x: 1, y: 0 },
        carriedResources: [],
        carryCapacityKg: 20,
      },
    });

    const diagonalResponse = await app.request("/eva/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x: 2, y: 1 }),
    });
    expect(diagonalResponse.status).toBe(409);
    expect(await diagonalResponse.json()).toEqual({
      error: {
        message: "EVA movement must be exactly one tile north, south, east, or west.",
      },
    });

    const jumpResponse = await app.request("/eva/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x: 5, y: 0 }),
    });
    expect(jumpResponse.status).toBe(409);
    expect(await jumpResponse.json()).toEqual({
      error: {
        message: "EVA movement must be exactly one tile north, south, east, or west.",
      },
    });

    const outOfBoundsResponse = await app.request("/eva/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x: 2, y: 0 }),
    });
    expect(outOfBoundsResponse.status).toBe(409);
    expect(await outOfBoundsResponse.json()).toEqual({
      error: {
        message: "EVA movement cannot leave the current Kepler sector.",
      },
    });

    const dockResponse = await app.request("/eva/dock", {
      method: "POST",
    });
    expect(dockResponse.status).toBe(409);
    expect(await dockResponse.json()).toEqual({
      error: {
        message: "EVA docking is only allowed at habitat origin (0, 0).",
      },
    });
    expect(store.readState().eva).toEqual({
      deployedHumanId: "human_1",
      suitportModuleId: "basic_suitport_1",
      position: { x: 1, y: 0 },
      carriedResources: [],
      carryCapacityKg: 20,
    });

    store.close();
  });

  test("collect route validates EVA state, calls Kepler, and adds carried material after success", async () => {
    const dir = createTempDir("collect-success");
    const store = new SqliteLocalStateStore(join(dir, "habitat.sqlite"));
    store.writeState({
      kepler: {
        baseUrl: "https://planet.turingguild.com",
        displayName: "Artemis Ridge",
        habitatUuid: "uuid-123",
        habitatId: "habitat_123",
        contracts: {
          alerts: {
            schemaVersion: "1.0",
            schema: {},
          },
        },
        starterModules: [],
        starterHumans: [],
        blueprints: [],
      },
      eva: {
        deployedHumanId: "human_1",
        suitportModuleId: "basic_suitport_1",
        position: { x: 1, y: 0 },
        carriedResources: [],
        carryCapacityKg: 20,
      },
    });
    const logs: string[] = [];
    const app = createHabitatApiApp({
      store,
      keplerToken: "test-token",
      logger: (line) => logs.push(line),
      fetchImpl: async (input, init) => {
        expect(String(input)).toBe("https://planet.turingguild.com/world/collect");
        expect(init?.method).toBe("POST");
        expect(init?.body).toBe(JSON.stringify({
          habitatId: "habitat_123",
          x: 1,
          y: 0,
          quantityKg: 5,
        }));
        return new Response(
          JSON.stringify({
            collection: {
              x: 1,
              y: 0,
              resourceType: "ferrite",
              unit: "kg",
              collectedKg: 5,
              remainingKg: 179,
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    });

    const response = await app.request("/collect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantityKg: 5 }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      collection: {
        x: 1,
        y: 0,
        resourceType: "ferrite",
        unit: "kg",
        collectedKg: 5,
        remainingKg: 179,
      },
      eva: {
        deployedHumanId: "human_1",
        suitportModuleId: "basic_suitport_1",
        position: { x: 1, y: 0 },
        carriedResources: [
          {
            resourceType: "ferrite",
            quantityKg: 5,
          },
        ],
        carryCapacityKg: 20,
      },
    });
    expect(store.readState().eva?.carriedResources).toEqual([
      {
        resourceType: "ferrite",
        quantityKg: 5,
      },
    ]);
    expect(logs).toEqual([
      "[kepler] POST /world/collect -> 200",
      "[habitat-api] POST /collect -> ferrite 5 kg",
    ]);

    store.close();
  });

  test("collect route rejects invalid local state and preserves carried material on Kepler failure", async () => {
    const dir = createTempDir("collect-failures");
    const store = new SqliteLocalStateStore(join(dir, "habitat.sqlite"));
    store.writeState({
      kepler: {
        baseUrl: "https://planet.turingguild.com",
        displayName: "Artemis Ridge",
        habitatUuid: "uuid-123",
        habitatId: "habitat_123",
        contracts: {
          alerts: {
            schemaVersion: "1.0",
            schema: {},
          },
        },
        starterModules: [],
        starterHumans: [],
        blueprints: [],
      },
      eva: {
        deployedHumanId: "human_1",
        suitportModuleId: "basic_suitport_1",
        position: { x: 1, y: 0 },
        carriedResources: [
          {
            resourceType: "ferrite",
            quantityKg: 18,
          },
        ],
        carryCapacityKg: 20,
      },
    });
    const app = createHabitatApiApp({
      store,
      keplerToken: "test-token",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            error: {
              message: "Tile has no material remaining.",
            },
          }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" },
          },
        ),
    });

    const overCapacityResponse = await app.request("/collect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantityKg: 3 }),
    });
    expect(overCapacityResponse.status).toBe(409);
    expect(await overCapacityResponse.json()).toEqual({
      error: {
        message: "Collecting that quantity would exceed EVA carrying capacity.",
      },
    });

    store.writeState({
      ...store.readState(),
      eva: {
        deployedHumanId: "human_1",
        suitportModuleId: "basic_suitport_1",
        position: { x: 1, y: 0 },
        carriedResources: [],
        carryCapacityKg: 20,
      },
    });

    const keplerFailureResponse = await app.request("/collect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantityKg: 1 }),
    });
    expect(keplerFailureResponse.status).toBe(409);
    expect(await keplerFailureResponse.json()).toEqual({
      error: {
        message: "Kepler request failed: 409 Tile has no material remaining.",
      },
    });
    expect(store.readState().eva?.carriedResources).toEqual([]);

    store.close();
  });

  test("eva dock unloads carried resources into inventory, clears EVA state, and resolves deployment alerts", async () => {
    const dir = createTempDir("dock-success");
    const store = new SqliteLocalStateStore(join(dir, "habitat.sqlite"));
    store.writeState({
      kepler: {
        baseUrl: "https://planet.turingguild.com",
        displayName: "Artemis Ridge",
        habitatUuid: "uuid-123",
        habitatId: "habitat_123",
        contracts: {
          alerts: {
            schemaVersion: "1.0",
            schema: {},
          },
        },
        starterModules: [],
        starterHumans: [],
        blueprints: [],
      },
      inventory: {
        ferrite: 10,
      },
      modules: [
        {
          id: "basic_suitport_1",
          blueprintId: "basic-suitport",
          displayName: "Basic Suitport",
          connectedTo: [],
          runtimeAttributes: {
            status: "online",
            crewCapacity: 1,
          },
          capabilities: ["limited-eva", "suitport-access"],
        },
      ],
      humans: [
        {
          id: "human_1",
          displayName: "Alex Vega",
          locationModuleId: "basic_suitport_1",
        },
      ],
      eva: {
        deployedHumanId: "human_1",
        suitportModuleId: "basic_suitport_1",
        position: { x: 0, y: 0 },
        carriedResources: [
          {
            resourceType: "ferrite",
            quantityKg: 5,
          },
        ],
        carryCapacityKg: 20,
      },
      alerts: [
        {
          id: "alert_1",
          code: "eva-human-deployed",
          title: "Human Deployed",
          description: "A human is outside the habitat.",
          severity: "warning",
          status: "open",
          source: "eva",
          openedAt: "2026-07-15T00:00:00.000Z",
          lastObservedAt: "2026-07-15T00:00:00.000Z",
          occurrenceCount: 1,
          subject: {
            type: "human",
            id: "human_1",
          },
        },
      ],
    });
    const app = createHabitatApiApp({
      store,
      keplerToken: "test-token",
    });

    const response = await app.request("/eva/dock", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      eva: {
        deployedHumanId: null,
        suitportModuleId: null,
        position: null,
        carriedResources: [],
        carryCapacityKg: 20,
      },
    });
    expect(store.readState().inventory).toEqual({
      ferrite: 15,
    });
    expect(store.readState().humans).toEqual([
      {
        id: "human_1",
        displayName: "Alex Vega",
        locationModuleId: "basic_suitport_1",
      },
    ]);
    expect(store.readState().alerts?.[0].status).toBe("resolved");
    expect(store.readState().alerts?.[0].resolvedAt).toEqual(expect.any(String));

    store.close();
  });

  test("alert routes list, acknowledge, dedupe repeated failures, and create capacity alerts", async () => {
    const dir = createTempDir("alert-routes");
    const store = new SqliteLocalStateStore(join(dir, "habitat.sqlite"));
    store.writeState({
      kepler: {
        baseUrl: "https://planet.turingguild.com",
        displayName: "Artemis Ridge",
        habitatUuid: "uuid-123",
        habitatId: "habitat_123",
        contracts: {
          alerts: {
            schemaVersion: "1.0",
            schema: {},
          },
        },
        starterModules: [],
        starterHumans: [],
        blueprints: [],
      },
      eva: {
        deployedHumanId: "human_1",
        suitportModuleId: "basic_suitport_1",
        position: { x: 1, y: 0 },
        carriedResources: [
          {
            resourceType: "ferrite",
            quantityKg: 19,
          },
        ],
        carryCapacityKg: 20,
      },
    });
    let collectRequestCount = 0;
    const app = createHabitatApiApp({
      store,
      keplerToken: "test-token",
      fetchImpl: async (input) => {
        if (String(input).endsWith("/world/collect")) {
          collectRequestCount += 1;
          if (collectRequestCount === 1) {
            return new Response(
              JSON.stringify({
                collection: {
                  x: 1,
                  y: 0,
                  resourceType: "ferrite",
                  unit: "kg",
                  collectedKg: 1,
                  remainingKg: 50,
                },
              }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              },
            );
          }

          return new Response(
            JSON.stringify({
              error: {
                message: "Tile has no material remaining.",
              },
            }),
            {
              status: 409,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        return new Response("not found", { status: 404 });
      },
    });

    const capacityResponse = await app.request("/collect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantityKg: 1 }),
    });
    expect(capacityResponse.status).toBe(200);

    store.writeState({
      ...store.readState(),
      eva: {
        deployedHumanId: "human_1",
        suitportModuleId: "basic_suitport_1",
        position: { x: 1, y: 0 },
        carriedResources: [],
        carryCapacityKg: 20,
      },
    });

    const firstFailure = await app.request("/collect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantityKg: 1 }),
    });
    expect(firstFailure.status).toBe(409);

    const secondFailure = await app.request("/collect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantityKg: 1 }),
    });
    expect(secondFailure.status).toBe(409);

    const listResponse = await app.request("/alerts");
    expect(listResponse.status).toBe(200);
    const listPayload = await listResponse.json();
    expect(listPayload.alerts).toHaveLength(2);

    const capacityAlert = listPayload.alerts.find((alert: { code: string }) => alert.code === "eva-carry-capacity-reached");
    expect(capacityAlert.status).toBe("open");
    expect(capacityAlert.occurrenceCount).toBe(1);

    const failureAlert = listPayload.alerts.find((alert: { code: string }) => alert.code === "eva-collection-failed");
    expect(failureAlert.status).toBe("open");
    expect(failureAlert.occurrenceCount).toBe(2);

    const acknowledgeResponse = await app.request(`/alerts/${failureAlert.id}/acknowledge`, {
      method: "POST",
    });
    expect(acknowledgeResponse.status).toBe(200);
    expect((await acknowledgeResponse.json()).alert.status).toBe("acknowledged");

    store.close();
  });

  test("state routes read and write the full local state snapshot", async () => {
    const dir = createTempDir("state-routes");
    const store = new SqliteLocalStateStore(join(dir, "habitat.sqlite"));
    store.writeState({
      inventory: { ferrite: 10 },
      modules: [
        {
          id: "module_1",
          blueprintId: "test-module",
          displayName: "Test Module",
          connectedTo: [],
          runtimeAttributes: {
            status: "online",
          },
          capabilities: [],
        },
      ],
      simulation: {
        currentTick: 42,
      },
    });
    const logs: string[] = [];
    const app = createHabitatApiApp({
      store,
      keplerToken: "test-token",
      logger: (line) => logs.push(line),
    });

    const getResponse = await app.request("/state");
    expect(getResponse.status).toBe(200);
    expect((await getResponse.json()).state.simulation.currentTick).toBe(42);

    const putResponse = await app.request("/state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        state: {
          inventory: { ferrite: 12 },
          modules: [],
          simulation: {
            currentTick: 99,
          },
        },
      }),
    });

    expect(putResponse.status).toBe(200);
    expect(store.readState()).toMatchObject({
      inventory: { ferrite: 12 },
      simulation: {
        currentTick: 99,
      },
    });
    expect(logs).toEqual([
      "[habitat-api] GET /state -> 1 modules, tick 42",
      "[habitat-api] PUT /state -> 0 modules, tick 99",
    ]);

    store.close();
  });
});
