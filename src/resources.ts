export type ResourceRecord = {
  id?: string;
  resourceType: string;
  displayName: string;
  kind: string;
  rarity: string;
  description?: string;
  unit?: string;
};

type FetchFunction = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type FetchResourceCatalogOptions = {
  baseUrl: string;
  headers: HeadersInit;
  fetchImpl?: FetchFunction;
};

type ResourceCatalogResponse = {
  resources?: ResourceRecord[];
};

function pad(value: string, width: number): string {
  return value.padEnd(width, " ");
}

export function formatResourceList(resources: ResourceRecord[]): string {
  if (resources.length === 0) {
    return "No resources found.";
  }

  const rows = resources.map((resource) => ({
    resourceType: resource.resourceType,
    displayName: resource.displayName,
    kind: resource.kind,
    rarity: resource.rarity,
    unit: resource.unit ?? "-",
  }));

  const resourceTypeWidth = Math.max("Resource Type".length, ...rows.map((row) => row.resourceType.length));
  const displayNameWidth = Math.max("Display Name".length, ...rows.map((row) => row.displayName.length));
  const kindWidth = Math.max("Kind".length, ...rows.map((row) => row.kind.length));
  const rarityWidth = Math.max("Rarity".length, ...rows.map((row) => row.rarity.length));
  const unitWidth = Math.max("Unit".length, ...rows.map((row) => row.unit.length));

  const header = [
    pad("Resource Type", resourceTypeWidth),
    pad("Display Name", displayNameWidth),
    pad("Kind", kindWidth),
    pad("Rarity", rarityWidth),
    pad("Unit", unitWidth),
  ].join("  ");

  const divider = [
    "-".repeat(resourceTypeWidth),
    "-".repeat(displayNameWidth),
    "-".repeat(kindWidth),
    "-".repeat(rarityWidth),
    "-".repeat(unitWidth),
  ].join("  ");

  const body = rows.map((row) =>
    [pad(row.resourceType, resourceTypeWidth), pad(row.displayName, displayNameWidth), pad(row.kind, kindWidth), pad(row.rarity, rarityWidth), row.unit].join(
      "  ",
    ),
  );

  return [header, divider, ...body].join("\n");
}

export async function fetchResourceCatalog(options: FetchResourceCatalogOptions): Promise<ResourceRecord[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${options.baseUrl}/catalog/resources`, {
    method: "GET",
    headers: options.headers,
  });

  if (!response.ok) {
    throw new Error("Unable to load the Kepler resource catalog.");
  }

  const payload = (await response.json()) as ResourceCatalogResponse;
  return payload.resources ?? [];
}
