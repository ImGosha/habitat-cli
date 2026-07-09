import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  fetchSolarIrradiance,
  formatSolarStatus,
  type SolarIrradiance,
} from "./solar.js";

const exampleIrradiance: SolarIrradiance = {
  wPerM2: 540,
  condition: "dusty",
};

afterEach(() => {
  mock.restore();
});

describe("solar formatting", () => {
  test("formats clear solar status output", () => {
    expect(formatSolarStatus(exampleIrradiance)).toBe(
      [
        "Solar Irradiance  540 W/m^2",
        "Condition         dusty",
      ].join("\n"),
    );
  });
});

describe("solar irradiance fetches", () => {
  test("fetches solar irradiance from the documented endpoint", async () => {
    const fetchMock = mock(async (input: string | URL | Request) => {
      expect(String(input)).toBe("https://planet.turingguild.com/world/solar-irradiance");
      return new Response(JSON.stringify({ solarIrradiance: exampleIrradiance }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = await fetchSolarIrradiance({
      baseUrl: "https://planet.turingguild.com",
      headers: { Authorization: "Bearer test" },
      fetchImpl: fetchMock,
    });

    expect(result).toEqual(exampleIrradiance);
  });

  test("also accepts the direct irradiance payload shape", async () => {
    const fetchMock = mock(async () => {
      return new Response(JSON.stringify(exampleIrradiance), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = await fetchSolarIrradiance({
      baseUrl: "https://planet.turingguild.com",
      headers: { Authorization: "Bearer test" },
      fetchImpl: fetchMock,
    });

    expect(result).toEqual(exampleIrradiance);
  });

  test("returns a friendly error when the response shape is invalid", async () => {
    const fetchMock = mock(async () => {
      return new Response(JSON.stringify({ watts: 540, weather: "dusty" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await expect(
      fetchSolarIrradiance({
        baseUrl: "https://planet.turingguild.com",
        headers: { Authorization: "Bearer test" },
        fetchImpl: fetchMock,
      }),
    ).rejects.toThrow("Unable to parse the Kepler solar irradiance response.");
  });

  test("returns a friendly error for non-ok responses", async () => {
    const fetchMock = mock(async () => {
      return new Response(JSON.stringify({ error: { code: "storm", message: "No visibility" } }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    });

    await expect(
      fetchSolarIrradiance({
        baseUrl: "https://planet.turingguild.com",
        headers: { Authorization: "Bearer test" },
        fetchImpl: fetchMock,
      }),
    ).rejects.toThrow("Unable to load the Kepler solar irradiance.");
  });
});
