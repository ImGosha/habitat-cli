import { afterEach, describe, expect, mock, test } from "bun:test";
import { fetchResourceCatalog, formatResourceList, type ResourceRecord } from "./resources.js";

const exampleResource: ResourceRecord = {
  id: "resource_ferrite",
  resourceType: "ferrite",
  displayName: "Ferrite",
  kind: "metal",
  rarity: "common",
  description: "A basic structural metal used in many construction recipes.",
  unit: "kg",
};

afterEach(() => {
  mock.restore();
});

describe("resource formatting", () => {
  test("formats a concise resource catalog table", () => {
    expect(formatResourceList([exampleResource])).toBe(
      [
        "Resource Type  Display Name  Kind   Rarity  Unit",
        "-------------  ------------  -----  ------  ----",
        "ferrite        Ferrite       metal  common  kg",
      ].join("\n"),
    );
  });
});

describe("resource catalog fetches", () => {
  test("fetches the resource catalog from the documented endpoint", async () => {
    const fetchMock = mock(async (input: string | URL | Request) => {
      expect(String(input)).toBe("https://planet.turingguild.com/catalog/resources");
      return new Response(JSON.stringify({ resources: [exampleResource] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = await fetchResourceCatalog({
      baseUrl: "https://planet.turingguild.com",
      headers: { Authorization: "Bearer test" },
      fetchImpl: fetchMock,
    });

    expect(result).toEqual([exampleResource]);
  });

  test("returns a friendly catalog error for non-ok responses", async () => {
    const fetchMock = mock(async () => {
      return new Response(JSON.stringify({ error: { code: "server_error", message: "Nope" } }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    });

    await expect(
      fetchResourceCatalog({
        baseUrl: "https://planet.turingguild.com",
        headers: { Authorization: "Bearer test" },
        fetchImpl: fetchMock,
      }),
    ).rejects.toThrow("Unable to load the Kepler resource catalog.");
  });
});
