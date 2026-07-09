import { formatTable } from "./cli-format.js";

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

export function formatResourceList(resources: ResourceRecord[]): string {
  if (resources.length === 0) {
    return "No resources found.";
  }

  return formatTable(
    ["Resource Type", "Display Name", "Kind", "Rarity", "Unit"],
    resources.map((resource) => [
      resource.resourceType,
      resource.displayName,
      resource.kind,
      resource.rarity,
      resource.unit ?? "-",
    ]),
  );
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
