import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  fetchBlueprintCatalog,
  fetchBlueprintDetails,
  formatBlueprintDetails,
  formatBlueprintList,
  type BlueprintRecord,
} from "./blueprints.js";

const exampleBlueprint: BlueprintRecord = {
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
  },
  buildTicks: 180,
  prerequisites: [],
  repeatable: true,
  runtimeAttributes: {
    status: "online",
    powerGenerationKw: 12,
  },
  capabilities: ["solar-generation"],
};

afterEach(() => {
  mock.restore();
});

describe("blueprint formatting", () => {
  test("formats a concise blueprint list table", () => {
    expect(formatBlueprintList([exampleBlueprint])).toBe(
      [
        "Blueprint ID       Output            Ticks  Prerequisites",
        "-----------------  ----------------  -----  -------------",
        "small-solar-array  module            180    none",
      ].join("\n"),
    );
  });

  test("formats readable details for one blueprint", () => {
    expect(formatBlueprintDetails(exampleBlueprint)).toBe(
      [
        "Blueprint ID: small-solar-array",
        "Display Name: Small Solar Array Blueprint",
        "Description: Generates starter solar power during clear daylight.",
        "Status: published",
        "Output: module",
        "Output Module Type: small-solar-array",
        "Build Ticks: 180",
        "Repeatable: yes",
        "Prerequisites: none",
        "Capabilities: solar-generation",
        "Inputs: {",
        '  "ferrite": 90,',
        '  "silicate-glass": 45',
        "}",
        "Runtime Attributes: {",
        '  "status": "online",',
        '  "powerGenerationKw": 12',
        "}",
      ].join("\n"),
    );
  });
});

describe("blueprint catalog fetches", () => {
  test("fetches the blueprint catalog from the documented endpoint", async () => {
    const fetchMock = mock(async (input: string | URL | Request) => {
      expect(String(input)).toBe("https://planet.turingguild.com/catalog/blueprints");
      return new Response(JSON.stringify({ blueprints: [exampleBlueprint] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = await fetchBlueprintCatalog({
      baseUrl: "https://planet.turingguild.com",
      headers: { Authorization: "Bearer test" },
      fetchImpl: fetchMock,
    });

    expect(result).toEqual([exampleBlueprint]);
  });

  test("fetches one blueprint by id from the documented endpoint", async () => {
    const fetchMock = mock(async (input: string | URL | Request) => {
      expect(String(input)).toBe("https://planet.turingguild.com/catalog/blueprints/small-solar-array");
      return new Response(JSON.stringify({ blueprint: exampleBlueprint }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = await fetchBlueprintDetails({
      baseUrl: "https://planet.turingguild.com",
      headers: { Authorization: "Bearer test" },
      blueprintId: "small-solar-array",
      fetchImpl: fetchMock,
    });

    expect(result).toEqual(exampleBlueprint);
  });

  test("returns a friendly missing-blueprint error for 404s", async () => {
    const fetchMock = mock(async () => {
      return new Response(JSON.stringify({ error: { code: "not_found", message: "Not found" } }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    });

    await expect(
      fetchBlueprintDetails({
        baseUrl: "https://planet.turingguild.com",
        headers: { Authorization: "Bearer test" },
        blueprintId: "missing-blueprint",
        fetchImpl: fetchMock,
      }),
    ).rejects.toThrow('Blueprint "missing-blueprint" was not found.');
  });
});
