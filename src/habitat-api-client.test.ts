import { describe, expect, test } from "bun:test";
import { HabitatApiClient } from "./habitat-api-client.js";

describe("habitat api client", () => {
  test("defaults to the local server base URL", async () => {
    let calledUrl = "";
    const client = new HabitatApiClient({
      baseUrl: "http://127.0.0.1:8787",
      fetchImpl: async (input) => {
        calledUrl = String(input);
        return new Response(JSON.stringify({ registration: null }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        });
      },
    });

    await client.getRegistration();

    expect(calledUrl).toBe("http://127.0.0.1:8787/registration");
  });

  test("uses HABITAT_API_BASE_URL and returns friendly backend errors", async () => {
    const previousBaseUrl = process.env.HABITAT_API_BASE_URL;
    process.env.HABITAT_API_BASE_URL = "http://localhost:18787";

    const client = new HabitatApiClient({
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: { message: "This CLI has not been registered with Kepler yet." } }), {
          status: 404,
          headers: {
            "Content-Type": "application/json",
          },
        }),
    });

    await expect(client.getStatus()).rejects.toThrow("This CLI has not been registered with Kepler yet.");

    process.env.HABITAT_API_BASE_URL = previousBaseUrl;
  });

  test("returns a beginner-friendly error when the local backend cannot be reached", async () => {
    const client = new HabitatApiClient({
      baseUrl: "http://127.0.0.1:8787",
      fetchImpl: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    });

    await expect(client.getRegistration()).rejects.toThrow(
      "Unable to reach the local Habitat API at http://127.0.0.1:8787. Start it with: bun run server",
    );
  });

  test("requests blueprint, resource, and solar routes through the local API", async () => {
    const calledUrls: string[] = [];
    const client = new HabitatApiClient({
      baseUrl: "http://127.0.0.1:8787",
      fetchImpl: async (input) => {
        calledUrls.push(String(input));
        return new Response(
          JSON.stringify(
            String(input).endsWith("/catalog/resources")
              ? { resources: [] }
              : String(input).endsWith("/solar/irradiance")
                ? { solarIrradiance: { wPerM2: 540, condition: "dusty" } }
                : String(input).includes("/catalog/blueprints/")
                  ? { blueprint: { blueprintId: "small-solar-array", displayName: "Small Solar Array" } }
                  : { blueprints: [] },
          ),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      },
    });

    await client.listBlueprints();
    await client.showBlueprint("small-solar-array");
    await client.listResources();
    await client.getSolarIrradiance();

    expect(calledUrls).toEqual([
      "http://127.0.0.1:8787/catalog/blueprints",
      "http://127.0.0.1:8787/catalog/blueprints/small-solar-array",
      "http://127.0.0.1:8787/catalog/resources",
      "http://127.0.0.1:8787/solar/irradiance",
    ]);
  });

  test("requests resource scans through the local API", async () => {
    let calledUrl = "";
    const client = new HabitatApiClient({
      baseUrl: "http://127.0.0.1:8787",
      fetchImpl: async (input) => {
        calledUrl = String(input);
        return new Response(
          JSON.stringify({
            scan: {
              modelVersion: "scan-v1",
              origin: { x: 3, y: -2 },
              sensorStrength: 60,
              radiusTiles: 1,
              tiles: [],
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

    await client.scan({ strength: 60, radius: 1 });

    expect(calledUrl).toBe("http://127.0.0.1:8787/scan?strength=60&radius=1");
  });

  test("requests module and inventory routes through the local API", async () => {
    const called: Array<{ url: string; method?: string; body?: string | null }> = [];
    const client = new HabitatApiClient({
      baseUrl: "http://127.0.0.1:8787",
      fetchImpl: async (input, init) => {
        called.push({
          url: String(input),
          method: init?.method,
          body: typeof init?.body === "string" ? init.body : null,
        });
        return new Response(
          JSON.stringify(
            String(input).includes("/inventory/")
              ? { resourceId: "ferrite", previousAmount: 10, newAmount: 15 }
              : String(input).endsWith("/inventory")
                ? { inventory: { ferrite: 10 } }
                : String(input).endsWith("/modules")
                  ? { modules: [] }
                  : { module: { id: "local_small_solar_array_2", blueprintId: "small-solar-array", displayName: "Test Module", connectedTo: [], runtimeAttributes: {}, capabilities: [] } },
          ),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    });

    await client.listModules();
    await client.showModule("small_solar_array_1");
    await client.createModule("small-solar-array", "Test Module");
    await client.updateModule("small_solar_array_1", { name: "Renamed Module", health: 95 });
    await client.deleteModule("small_solar_array_1");
    await client.listInventory();
    await client.changeInventory("ferrite", 5);

    expect(called).toEqual([
      { url: "http://127.0.0.1:8787/modules", method: "GET", body: null },
      { url: "http://127.0.0.1:8787/modules/small_solar_array_1", method: "GET", body: null },
      {
        url: "http://127.0.0.1:8787/modules",
        method: "POST",
        body: JSON.stringify({ blueprintId: "small-solar-array", name: "Test Module" }),
      },
      {
        url: "http://127.0.0.1:8787/modules/small_solar_array_1",
        method: "PATCH",
        body: JSON.stringify({ name: "Renamed Module", health: 95 }),
      },
      { url: "http://127.0.0.1:8787/modules/small_solar_array_1", method: "DELETE", body: null },
      { url: "http://127.0.0.1:8787/inventory", method: "GET", body: null },
      {
        url: "http://127.0.0.1:8787/inventory/ferrite",
        method: "PUT",
        body: JSON.stringify({ delta: 5 }),
      },
    ]);
  });

  test("requests human routes through the local API", async () => {
    const called: Array<{ url: string; method?: string; body?: string | null }> = [];
    const client = new HabitatApiClient({
      baseUrl: "http://127.0.0.1:8787",
      fetchImpl: async (input, init) => {
        called.push({
          url: String(input),
          method: init?.method,
          body: typeof init?.body === "string" ? init.body : null,
        });
        return new Response(
          JSON.stringify(
            String(input).endsWith("/humans")
              ? {
                  humans: [
                    {
                      id: "human_1",
                      displayName: "Alex Vega",
                      locationModuleId: "command_module_1",
                    },
                  ],
                }
              : {
                  human: {
                    id: "human_1",
                    displayName: "Alex Vega",
                    locationModuleId: "basic_suitport_1",
                  },
                },
          ),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    });

    await client.listHumans();
    await client.moveHuman("human_1", "basic_suitport_1");

    expect(called).toEqual([
      { url: "http://127.0.0.1:8787/humans", method: "GET", body: null },
      {
        url: "http://127.0.0.1:8787/humans/human_1/move",
        method: "POST",
        body: JSON.stringify({ destinationModuleId: "basic_suitport_1" }),
      },
    ]);
  });

  test("requests local state snapshot routes through the local API", async () => {
    const called: Array<{ url: string; method?: string; body?: string | null }> = [];
    const client = new HabitatApiClient({
      baseUrl: "http://127.0.0.1:8787",
      fetchImpl: async (input, init) => {
        called.push({
          url: String(input),
          method: init?.method,
          body: typeof init?.body === "string" ? init.body : null,
        });
        return new Response(
          JSON.stringify({
            state: {
              modules: [],
              inventory: {},
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    });

    await client.getLocalState();
    await client.saveLocalState({
      modules: [],
      inventory: {},
    });

    expect(called).toEqual([
      { url: "http://127.0.0.1:8787/state", method: "GET", body: null },
      {
        url: "http://127.0.0.1:8787/state",
        method: "PUT",
        body: JSON.stringify({ state: { modules: [], inventory: {} } }),
      },
    ]);
  });

  test("requests eva, collect, and alert routes through the local API", async () => {
    const called: Array<{ url: string; method?: string; body?: string | null }> = [];
    const client = new HabitatApiClient({
      baseUrl: "http://127.0.0.1:8787",
      fetchImpl: async (input, init) => {
        called.push({
          url: String(input),
          method: init?.method,
          body: typeof init?.body === "string" ? init.body : null,
        });
        return new Response(
          JSON.stringify(
            String(input).endsWith("/eva")
              ? { eva: { deployedHumanId: null, suitportModuleId: null, position: null, carriedResources: [], carryCapacityKg: 20 } }
              : String(input).endsWith("/eva/deploy") || String(input).endsWith("/eva/move") || String(input).endsWith("/eva/dock")
                ? { eva: { deployedHumanId: "human_1", suitportModuleId: "basic_suitport_1", position: { x: 0, y: 0 }, carriedResources: [], carryCapacityKg: 20 } }
                : String(input).endsWith("/collect")
                  ? {
                      collection: { x: 0, y: 0, resourceType: "ferrite", unit: "kg", collectedKg: 1, remainingKg: 9 },
                      eva: { deployedHumanId: "human_1", suitportModuleId: "basic_suitport_1", position: { x: 0, y: 0 }, carriedResources: [{ resourceType: "ferrite", quantityKg: 1 }], carryCapacityKg: 20 },
                    }
                  : String(input).endsWith("/alerts")
                    ? { alerts: [{ id: "alert_1", code: "eva-human-deployed", title: "Human Deployed", description: "A human is outside the habitat.", severity: "warning", status: "open", source: "eva", openedAt: "2026-07-15T00:00:00.000Z", lastObservedAt: "2026-07-15T00:00:00.000Z", occurrenceCount: 1 }] }
                    : { alert: { id: "alert_1", code: "eva-human-deployed", title: "Human Deployed", description: "A human is outside the habitat.", severity: "warning", status: "acknowledged", source: "eva", openedAt: "2026-07-15T00:00:00.000Z", lastObservedAt: "2026-07-15T00:00:01.000Z", occurrenceCount: 1 } },
          ),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    });

    await client.getEvaStatus();
    await client.deployEva("human_1");
    await client.moveEva(1, 0);
    await client.dockEva();
    await client.collectResource(1);
    await client.listAlerts();
    await client.acknowledgeAlert("alert_1");

    expect(called).toEqual([
      { url: "http://127.0.0.1:8787/eva", method: "GET", body: null },
      { url: "http://127.0.0.1:8787/eva/deploy", method: "POST", body: JSON.stringify({ humanId: "human_1" }) },
      { url: "http://127.0.0.1:8787/eva/move", method: "POST", body: JSON.stringify({ x: 1, y: 0 }) },
      { url: "http://127.0.0.1:8787/eva/dock", method: "POST", body: null },
      { url: "http://127.0.0.1:8787/collect", method: "POST", body: JSON.stringify({ quantityKg: 1 }) },
      { url: "http://127.0.0.1:8787/alerts", method: "GET", body: null },
      { url: "http://127.0.0.1:8787/alerts/alert_1/acknowledge", method: "POST", body: null },
    ]);
  });
});
