import { formatKeyValueRows } from "./cli-format.js";

export type SolarIrradiance = {
  wPerM2: number;
  condition: string;
};

type FetchFunction = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type FetchSolarIrradianceOptions = {
  baseUrl: string;
  headers: HeadersInit;
  fetchImpl?: FetchFunction;
};

type SolarIrradianceResponse = {
  solarIrradiance?: SolarIrradiance;
};

function isSolarIrradiance(value: unknown): value is SolarIrradiance {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.wPerM2 === "number" && Number.isFinite(record.wPerM2) && typeof record.condition === "string";
}

function parseSolarIrradiance(value: unknown): SolarIrradiance | undefined {
  if (isSolarIrradiance(value)) {
    return value;
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const response = value as SolarIrradianceResponse;
  return isSolarIrradiance(response.solarIrradiance) ? response.solarIrradiance : undefined;
}

export function formatSolarStatus(irradiance: SolarIrradiance): string {
  return formatKeyValueRows([
    ["Solar Irradiance", `${irradiance.wPerM2} W/m^2`],
    ["Condition", irradiance.condition],
  ]);
}

export async function fetchSolarIrradiance(options: FetchSolarIrradianceOptions): Promise<SolarIrradiance> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${options.baseUrl}/world/solar-irradiance`, {
    method: "GET",
    headers: options.headers,
  });

  if (!response.ok) {
    throw new Error("Unable to load the Kepler solar irradiance.");
  }

  const payload = (await response.json()) as unknown;
  const irradiance = parseSolarIrradiance(payload);

  if (!irradiance) {
    throw new Error("Unable to parse the Kepler solar irradiance response.");
  }

  return irradiance;
}
