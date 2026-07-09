import { formatKeyValueRows, formatSection, formatTable, formatUnknownValue } from "./cli-format.js";

type BlueprintOutput = Record<string, unknown>;

export type BlueprintRecord = {
  id?: string;
  blueprintId: string;
  displayName: string;
  description?: string;
  status?: string;
  output?: BlueprintOutput;
  inputs?: Record<string, unknown>;
  productionCost?: Record<string, unknown>;
  requiredFacility?: Record<string, unknown>;
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

function getOutputItemType(blueprint: BlueprintRecord): string {
  return typeof blueprint.output?.itemType === "string" ? blueprint.output.itemType : "unknown";
}

function getPrerequisitesLabel(blueprint: BlueprintRecord): string {
  return blueprint.prerequisites && blueprint.prerequisites.length > 0 ? blueprint.prerequisites.join(", ") : "none";
}

export function formatBlueprintList(blueprints: BlueprintRecord[]): string {
  if (blueprints.length === 0) {
    return "No blueprints found.";
  }

  return formatTable(
    ["Blueprint ID", "Output", "Ticks", "Prerequisites"],
    blueprints.map((blueprint) => [
      blueprint.blueprintId,
      getOutputItemType(blueprint),
      blueprint.buildTicks !== undefined ? String(blueprint.buildTicks) : "unknown",
      getPrerequisitesLabel(blueprint),
    ]),
  );
}

export function formatBlueprintDetails(blueprint: BlueprintRecord): string {
  const outputModuleType =
    typeof blueprint.output?.moduleType === "string" ? blueprint.output.moduleType : "unknown";

  const summary = formatKeyValueRows([
    ["Blueprint ID", blueprint.blueprintId],
    ["Display Name", blueprint.displayName],
    ["Description", blueprint.description ?? "None"],
    ["Status", blueprint.status ?? "unknown"],
    ["Output", getOutputItemType(blueprint)],
    ["Output Module Type", outputModuleType],
    ["Build Ticks", String(blueprint.buildTicks ?? "unknown")],
    ["Repeatable", blueprint.repeatable ? "yes" : "no"],
    ["Prerequisites", getPrerequisitesLabel(blueprint)],
    [
      "Capabilities",
      blueprint.capabilities && blueprint.capabilities.length > 0 ? blueprint.capabilities.join(", ") : "none",
    ],
  ]);

  const inputs = Object.keys(blueprint.inputs ?? {}).length > 0
    ? formatTable(
        ["Input", "Amount"],
        Object.entries(blueprint.inputs ?? {}).map(([key, value]) => [key, formatUnknownValue(value)]),
      )
    : "No inputs.";

  const runtimeAttributes = Object.keys(blueprint.runtimeAttributes ?? {}).length > 0
    ? formatTable(
        ["Attribute", "Value"],
        Object.entries(blueprint.runtimeAttributes ?? {}).map(([key, value]) => [key, formatUnknownValue(value)]),
      )
    : "No runtime attributes.";

  return [
    formatSection("Summary", summary),
    formatSection("Inputs", inputs),
    formatSection("Runtime Attributes", runtimeAttributes),
  ].join("\n\n");
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
