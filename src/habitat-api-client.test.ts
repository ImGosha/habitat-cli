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

    await client.scan({ x: 3, y: -2, strength: 60, radius: 1 });

    expect(calledUrl).toBe("http://127.0.0.1:8787/scan?x=3&y=-2&strength=60&radius=1");
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
});
