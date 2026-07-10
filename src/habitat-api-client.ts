import type {
  BlueprintCatalogResponse,
  BlueprintDetailsResponse,
  InventoryMutationResponse,
  InventoryResponse,
  LocalStateResponse,
  ModuleListResponse,
  ModuleResponse,
  RegistrationCreateResponse,
  RegistrationDeleteResponse,
  RegistrationResponse,
  RegistrationStatusResponse,
  ResourceCatalogResponse,
  SolarIrradianceResponse,
} from "./habitat-api.js";

type FetchFunction = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type ApiErrorPayload = {
  error?: {
    message?: string;
  };
};

type HabitatApiClientOptions = {
  baseUrl?: string;
  fetchImpl?: FetchFunction;
};

const defaultHabitatApiBaseUrl = "http://127.0.0.1:8787";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function getApiBaseUrl(providedBaseUrl?: string): string {
  return trimTrailingSlash(providedBaseUrl ?? process.env.HABITAT_API_BASE_URL ?? defaultHabitatApiBaseUrl);
}

export class HabitatApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchFunction;

  constructor(options: HabitatApiClientOptions = {}) {
    this.baseUrl = getApiBaseUrl(options.baseUrl);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getRegistration(): Promise<RegistrationResponse> {
    return this.requestJson<RegistrationResponse>("/registration", {
      method: "GET",
    });
  }

  async registerHabitat(displayName: string): Promise<RegistrationCreateResponse> {
    return this.requestJson<RegistrationCreateResponse>("/registration", {
      method: "POST",
      body: JSON.stringify({ displayName }),
    });
  }

  async getStatus(): Promise<RegistrationStatusResponse> {
    return this.requestJson<RegistrationStatusResponse>("/status", {
      method: "GET",
    });
  }

  async unregisterHabitat(): Promise<RegistrationDeleteResponse> {
    return this.requestJson<RegistrationDeleteResponse>("/registration", {
      method: "DELETE",
    });
  }

  async listBlueprints(): Promise<BlueprintCatalogResponse> {
    return this.requestJson<BlueprintCatalogResponse>("/catalog/blueprints", {
      method: "GET",
    });
  }

  async showBlueprint(blueprintId: string): Promise<BlueprintDetailsResponse> {
    return this.requestJson<BlueprintDetailsResponse>(`/catalog/blueprints/${encodeURIComponent(blueprintId)}`, {
      method: "GET",
    });
  }

  async listResources(): Promise<ResourceCatalogResponse> {
    return this.requestJson<ResourceCatalogResponse>("/catalog/resources", {
      method: "GET",
    });
  }

  async getSolarIrradiance(): Promise<SolarIrradianceResponse> {
    return this.requestJson<SolarIrradianceResponse>("/solar/irradiance", {
      method: "GET",
    });
  }

  async listModules(): Promise<ModuleListResponse> {
    return this.requestJson<ModuleListResponse>("/modules", {
      method: "GET",
    });
  }

  async showModule(moduleId: string): Promise<ModuleResponse> {
    return this.requestJson<ModuleResponse>(`/modules/${encodeURIComponent(moduleId)}`, {
      method: "GET",
    });
  }

  async createModule(blueprintId: string, name: string): Promise<ModuleResponse> {
    return this.requestJson<ModuleResponse>("/modules", {
      method: "POST",
      body: JSON.stringify({ blueprintId, name }),
    });
  }

  async updateModule(
    moduleId: string,
    updates: {
      name?: string;
      status?: string;
      health?: number;
    },
  ): Promise<ModuleResponse> {
    return this.requestJson<ModuleResponse>(`/modules/${encodeURIComponent(moduleId)}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
  }

  async deleteModule(moduleId: string): Promise<ModuleResponse> {
    return this.requestJson<ModuleResponse>(`/modules/${encodeURIComponent(moduleId)}`, {
      method: "DELETE",
    });
  }

  async listInventory(): Promise<InventoryResponse> {
    return this.requestJson<InventoryResponse>("/inventory", {
      method: "GET",
    });
  }

  async changeInventory(resourceId: string, delta: number): Promise<InventoryMutationResponse> {
    return this.requestJson<InventoryMutationResponse>(`/inventory/${encodeURIComponent(resourceId)}`, {
      method: "PUT",
      body: JSON.stringify({ delta }),
    });
  }

  async getLocalState(): Promise<LocalStateResponse> {
    return this.requestJson<LocalStateResponse>("/state", {
      method: "GET",
    });
  }

  async saveLocalState(state: LocalStateResponse["state"]): Promise<LocalStateResponse> {
    return this.requestJson<LocalStateResponse>("/state", {
      method: "PUT",
      body: JSON.stringify({ state }),
    });
  }

  private async requestJson<T>(path: string, init: RequestInit): Promise<T> {
    let response: Response;

    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
    } catch {
      throw new Error(`Unable to reach the local Habitat API at ${this.baseUrl}. Start it with: bun run server`);
    }

    const text = await response.text();
    const payload = text.length > 0 ? (JSON.parse(text) as T | ApiErrorPayload) : undefined;

    if (!response.ok) {
      const message =
        (payload as ApiErrorPayload | undefined)?.error?.message ??
        `Habitat API request failed: ${response.status} ${response.statusText}`;
      throw new Error(message);
    }

    return payload as T;
  }
}
