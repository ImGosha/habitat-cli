type BlueprintOutput = Record<string, unknown>;

export type BlueprintRecord = {
  id?: string;
  blueprintId: string;
  displayName: string;
  description?: string;
  status?: string;
  output?: BlueprintOutput;
  inputs?: Record<string, unknown>;
  buildTicks?: number;
  prerequisites?: string[];
  repeatable?: boolean;
  runtimeAttributes?: Record<string, unknown>;
  capabilities?: string[];
};

type FetchBlueprintCatalogOptions = {
  baseUrl: string;
  headers: HeadersInit;
  fetchImpl?: FetchFunction;
};

type FetchBlueprintDetailsOptions = FetchBlueprintCatalogOptions & {
  blueprintId: string;
};

type FetchFunction = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type BlueprintCatalogResponse = {
  blueprints?: BlueprintRecord[];
};

type BlueprintResponse = {
  blueprint?: BlueprintRecord;
};

function formatJsonBlock(value: Record<string, unknown> | undefined): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function getOutputItemType(blueprint: BlueprintRecord): string {
  return typeof blueprint.output?.itemType === "string" ? blueprint.output.itemType : "unknown";
}

function getPrerequisitesLabel(blueprint: BlueprintRecord): string {
  return blueprint.prerequisites && blueprint.prerequisites.length > 0 ? blueprint.prerequisites.join(", ") : "none";
}

function pad(value: string, width: number): string {
  return value.padEnd(width, " ");
}

export function formatBlueprintList(blueprints: BlueprintRecord[]): string {
  if (blueprints.length === 0) {
    return "No blueprints found.";
  }

  const rows = blueprints.map((blueprint) => ({
    blueprintId: blueprint.blueprintId,
    output: getOutputItemType(blueprint),
    ticks: blueprint.buildTicks !== undefined ? String(blueprint.buildTicks) : "unknown",
    prerequisites: getPrerequisitesLabel(blueprint),
  }));

  const blueprintIdWidth = Math.max("Blueprint ID".length, ...rows.map((row) => row.blueprintId.length));
  const outputWidth = Math.max("Output".length, 16, ...rows.map((row) => row.output.length));
  const ticksWidth = Math.max("Ticks".length, ...rows.map((row) => row.ticks.length));
  const prerequisitesWidth = Math.max("Prerequisites".length, ...rows.map((row) => row.prerequisites.length));

  const header = [
    pad("Blueprint ID", blueprintIdWidth),
    pad("Output", outputWidth),
    pad("Ticks", ticksWidth),
    pad("Prerequisites", prerequisitesWidth),
  ].join("  ");

  const divider = [
    "-".repeat(blueprintIdWidth),
    "-".repeat(outputWidth),
    "-".repeat(ticksWidth),
    "-".repeat(prerequisitesWidth),
  ].join("  ");

  const body = rows.map((row) =>
    [pad(row.blueprintId, blueprintIdWidth), pad(row.output, outputWidth), pad(row.ticks, ticksWidth), row.prerequisites].join(
      "  ",
    ),
  );

  return [header, divider, ...body].join("\n");
}

export function formatBlueprintDetails(blueprint: BlueprintRecord): string {
  const outputModuleType =
    typeof blueprint.output?.moduleType === "string" ? blueprint.output.moduleType : "unknown";

  return [
    `Blueprint ID: ${blueprint.blueprintId}`,
    `Display Name: ${blueprint.displayName}`,
    `Description: ${blueprint.description ?? "None"}`,
    `Status: ${blueprint.status ?? "unknown"}`,
    `Output: ${getOutputItemType(blueprint)}`,
    `Output Module Type: ${outputModuleType}`,
    `Build Ticks: ${blueprint.buildTicks ?? "unknown"}`,
    `Repeatable: ${blueprint.repeatable ? "yes" : "no"}`,
    `Prerequisites: ${getPrerequisitesLabel(blueprint)}`,
    `Capabilities: ${blueprint.capabilities && blueprint.capabilities.length > 0 ? blueprint.capabilities.join(", ") : "none"}`,
    `Inputs: ${formatJsonBlock(blueprint.inputs)}`,
    `Runtime Attributes: ${formatJsonBlock(blueprint.runtimeAttributes)}`,
  ].join("\n");
}

export async function fetchBlueprintCatalog(options: FetchBlueprintCatalogOptions): Promise<BlueprintRecord[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${options.baseUrl}/catalog/blueprints`, {
    method: "GET",
    headers: options.headers,
  });

  if (!response.ok) {
    throw new Error("Unable to load the Kepler blueprint catalog.");
  }

  const payload = (await response.json()) as BlueprintCatalogResponse;
  return payload.blueprints ?? [];
}

export async function fetchBlueprintDetails(options: FetchBlueprintDetailsOptions): Promise<BlueprintRecord> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${options.baseUrl}/catalog/blueprints/${options.blueprintId}`, {
    method: "GET",
    headers: options.headers,
  });

  if (response.status === 404) {
    throw new Error(`Blueprint "${options.blueprintId}" was not found.`);
  }

  if (!response.ok) {
    throw new Error(`Unable to load blueprint "${options.blueprintId}" from Kepler.`);
  }

  const payload = (await response.json()) as BlueprintResponse;

  if (!payload.blueprint) {
    throw new Error(`Blueprint "${options.blueprintId}" was not found.`);
  }

  return payload.blueprint;
}
