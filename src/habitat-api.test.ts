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
      starterModules: [],
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
    expect(store.readState().modules?.length).toBe(1);
    expect(logs).toEqual([
      "[kepler] POST /habitats/register -> 201",
      "[habitat-api] POST /registration -> 1 starter modules",
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

  test("GET /scan validates inputs, supplies habitatId, and returns the Kepler scan payload unchanged", async () => {
    const dir = createTempDir("scan-route");
    const store = new SqliteLocalStateStore(join(dir, "habitat.sqlite"));
    store.writeState(exampleState());
    const logs: string[] = [];
    const app = createHabitatApiApp({
      store,
      keplerToken: "test-token",
      logger: (line) => logs.push(line),
      fetchImpl: async (input, init) => {
        expect(String(input)).toBe(
          "https://planet.turingguild.com/world/scan?habitatId=habitat_123&x=3&y=-2&sensorStrength=60&radiusTiles=1",
        );
        expect(init?.method).toBe("GET");
        return new Response(
          JSON.stringify({
            scan: {
              modelVersion: "scan-v1",
              origin: {
                x: 3,
                y: -2,
              },
              sensorStrength: 60,
              radiusTiles: 1,
              tiles: [
                {
                  x: 3,
                  y: -2,
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

    const response = await app.request("/scan?x=3&y=-2&strength=60&radius=1");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      scan: {
        modelVersion: "scan-v1",
        origin: {
          x: 3,
          y: -2,
        },
        sensorStrength: 60,
        radiusTiles: 1,
        tiles: [
          {
            x: 3,
            y: -2,
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
      "[kepler] GET /world/scan?habitatId=habitat_123&x=3&y=-2&sensorStrength=60&radiusTiles=1 -> 200",
      "[habitat-api] GET /scan -> 1 tiles",
    ]);

    store.close();
  });

  test("GET /scan returns clear validation errors", async () => {
    const dir = createTempDir("scan-validation");
    const store = new SqliteLocalStateStore(join(dir, "habitat.sqlite"));
    store.writeState(exampleState());
    const app = createHabitatApiApp({
      store,
      keplerToken: "test-token",
    });

    const badStrength = await app.request("/scan?x=3&y=-2&strength=101&radius=0");
    expect(badStrength.status).toBe(400);
    expect(await badStrength.json()).toEqual({
      error: {
        message: "strength must be an integer from 0 through 100.",
      },
    });

    const badRadius = await app.request("/scan?x=3&y=-2&strength=60&radius=6");
    expect(badRadius.status).toBe(400);
    expect(await badRadius.json()).toEqual({
      error: {
        message: "radius must be an integer from 0 through 5.",
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
