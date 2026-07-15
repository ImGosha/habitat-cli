import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Hono } from "hono";
import { acknowledgeAlert, listAlerts, openOrUpdateAlert, resolveAlertByCode } from "./alerts.js";
import { fetchBlueprintCatalog, fetchBlueprintDetails, type BlueprintRecord } from "./blueprints.js";
import { addCarriedResource, ensureCarryCapacity, type WorldCollectionRecord, validateCollectionQuantity } from "./collection.js";
import { getEffectiveInventory } from "./construction.js";
import { deployHumanForEva, ensureDockable, getEvaState, moveEva, type WorldSectorBounds } from "./eva.js";
import { canMoveHumanToModule, findHumanById } from "./humans.js";
import { cloneModule, type HabitatRegistrationRecord, type HabitatAlertContracts, type StarterHumanRecord } from "./local-state.js";
import { SqliteLocalStateStore } from "./local-state-storage.js";
import { addInventoryResource, removeInventoryResource } from "./inventory.js";
import { createNextLocalModuleId } from "./local-module-ids.js";
import { findModuleById, isModuleRuntimeStatus, type ModuleRecord } from "./modules.js";
import { fetchResourceCatalog, type ResourceRecord } from "./resources.js";
import { getHabitatSqlitePath, findProjectRootPath } from "./project-paths.js";
import type { ScanResponse } from "./scan.js";
import { fetchSolarIrradiance, type SolarIrradiance } from "./solar.js";

export type RegistrationResponse =
  | {
      registration: null;
    }
  | {
      registration: {
        habitatUuid: string;
        habitatId: string;
        displayName: string;
      };
    };

export type RegistrationCreateResponse = {
  registration: {
    displayName: string;
    habitatUuid: string;
    habitatId: string;
    starterModules: number;
    blueprints: number;
  };
};

export type RegistrationStatusResponse = {
  registration: {
    displayName: string;
    habitatUuid: string;
    habitatId: string;
    baseUrl: string;
    habitatSlug?: string;
    status?: string;
    catalogVersion?: string;
    lastSeenAt?: string | null;
    starterModules: number;
    blueprints: number;
    localModules: number;
  };
};

export type RegistrationDeleteResponse = {
  registration: {
    displayName: string;
    status: string;
  };
};

export type BlueprintCatalogResponse = {
  blueprints: BlueprintRecord[];
};

export type BlueprintDetailsResponse = {
  blueprint: BlueprintRecord;
};

export type ResourceCatalogResponse = {
  resources: ResourceRecord[];
};

export type SolarIrradianceResponse = {
  solarIrradiance: SolarIrradiance;
};

export type ResourceScanResponse = ScanResponse;

export type ModuleListResponse = {
  modules: ModuleRecord[];
};

export type ModuleResponse = {
  module: ModuleRecord;
};

export type HumanListResponse = {
  humans: StarterHumanRecord[];
};

export type HumanResponse = {
  human: StarterHumanRecord;
};

export type InventoryResponse = {
  inventory: Record<string, number>;
};

export type InventoryMutationResponse = {
  resourceId: string;
  previousAmount: number;
  newAmount: number;
};

export type EvaResponse = {
  eva: import("./local-state.js").LocalEvaState;
};

export type CollectionResponse = {
  collection: WorldCollectionRecord;
  eva: import("./local-state.js").LocalEvaState;
};

export type AlertListResponse = {
  alerts: import("./local-state.js").AlertRecord[];
};

export type AlertResponse = {
  alert: import("./local-state.js").AlertRecord;
};

export type LocalStateResponse = {
  state: import("./local-state.js").LocalState;
};

type FetchFunction = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type HabitatApiOptions = {
  store?: SqliteLocalStateStore;
  fetchImpl?: FetchFunction;
  keplerBaseUrl?: string;
  keplerToken?: string;
  createUuid?: () => string;
  logger?: (line: string) => void;
};

type KeplerRegistrationResponse = {
  habitatId: string;
  contracts?: HabitatAlertContracts;
  starterModules: ModuleRecord[];
  starterHumans: StarterHumanRecord[];
  blueprints: Array<Record<string, unknown>>;
};

type KeplerHabitatResponse = {
  habitat: {
    id: string;
    habitatSlug: string;
    displayName: string;
    catalogVersion: string;
    status: string;
    lastSeenAt?: string | null;
  };
};

type ApiErrorResponse = {
  error: {
    message: string;
  };
};

type WorldSectorResponse = {
  sector: {
    bounds: WorldSectorBounds;
  };
};

const defaultKeplerBaseUrl = "https://planet.turingguild.com";

dotenv.config({ path: join(findProjectRootPath(), ".env"), quiet: true });

function createErrorResponse(message: string): ApiErrorResponse {
  return {
    error: {
      message,
    },
  };
}

function getKeplerBaseUrl(providedBaseUrl?: string): string {
  return providedBaseUrl ?? process.env.KEPLER_BASE_URL ?? defaultKeplerBaseUrl;
}

function getKeplerToken(providedToken?: string): string {
  const token = providedToken ?? process.env.KEPLER_PLANET_TOKEN;

  if (!token) {
    throw new Error("Missing KEPLER_PLANET_TOKEN in backend environment.");
  }

  return token;
}

function logLine(logger: HabitatApiOptions["logger"], line: string): void {
  if (logger) {
    logger(line);
    return;
  }

  console.log(line);
}

function parseIntegerQueryValue(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }

  if (!/^-?\d+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

export function createHabitatApiApp(options: HabitatApiOptions = {}): Hono {
  const store = options.store ?? new SqliteLocalStateStore(getHabitatSqlitePath());
  const fetchImpl = options.fetchImpl ?? fetch;
  const keplerBaseUrl = getKeplerBaseUrl(options.keplerBaseUrl);
  const keplerToken = getKeplerToken(options.keplerToken);
  const createUuid = options.createUuid ?? randomUUID;
  const app = new Hono();

  async function keplerRequest(path: string, init: RequestInit): Promise<Response> {
    const response = await fetchImpl(`${keplerBaseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${keplerToken}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });

    logLine(options.logger, `[kepler] ${init.method ?? "GET"} ${path} -> ${response.status}`);

    return response;
  }

  async function getCurrentSectorBounds(habitatId: string): Promise<WorldSectorBounds> {
    const path = `/world/sectors/current?${new URLSearchParams({ habitatId }).toString()}`;
    const response = await keplerRequest(path, { method: "GET" });

    if (!response.ok) {
      const message = (await response.text()).trim() || "Unable to load the current Kepler sector.";
      throw new Error(`Kepler request failed: ${response.status} ${message}`);
    }

    const payload = (await response.json()) as WorldSectorResponse;
    return payload.sector.bounds;
  }

  app.get("/registration", (context) => {
    const state = store.readState();
    const registration = state.kepler;

    if (!registration) {
      logLine(options.logger, "[habitat-api] GET /registration -> not registered");
      return context.json<RegistrationResponse>({
        registration: null,
      });
    }

    logLine(options.logger, "[habitat-api] GET /registration -> registered");
    return context.json<RegistrationResponse>({
      registration: {
        habitatUuid: registration.habitatUuid,
        habitatId: registration.habitatId,
        displayName: registration.displayName,
      },
    });
  });

  app.post("/registration", async (context) => {
    const state = store.readState();

    if (state.kepler) {
      return context.json<ApiErrorResponse>(
        createErrorResponse(`This CLI is already registered with Kepler as "${state.kepler.displayName}".`),
        409,
      );
    }

    const body = (await context.req.json()) as { displayName?: unknown };

    if (typeof body.displayName !== "string" || body.displayName.trim().length === 0) {
      return context.json<ApiErrorResponse>(createErrorResponse("displayName is required."), 400);
    }

    const habitatUuid = createUuid();
    const response = await keplerRequest("/habitats/register", {
      method: "POST",
      body: JSON.stringify({
        displayName: body.displayName,
        habitatUuid,
      }),
    });

    if (!response.ok) {
      const message = (await response.text()).trim() || "Unable to register with Kepler.";
      return context.json<ApiErrorResponse>(createErrorResponse(`Kepler request failed: ${response.status} ${message}`), 502);
    }

    const registration = (await response.json()) as KeplerRegistrationResponse;

    state.kepler = {
      baseUrl: keplerBaseUrl,
      displayName: body.displayName,
      habitatUuid,
      habitatId: registration.habitatId,
      contracts: registration.contracts,
      starterModules: registration.starterModules,
      starterHumans: registration.starterHumans,
      blueprints: registration.blueprints as HabitatRegistrationRecord["blueprints"],
    };
    state.inventory = getEffectiveInventory(state);
    state.modules = registration.starterModules.map(cloneModule);
    state.humans = registration.starterHumans.map((human) => ({
      id: human.id,
      displayName: human.displayName,
      locationModuleId: human.locationModuleId,
    }));
    store.writeState(state);

    logLine(
      options.logger,
      `[habitat-api] POST /registration -> ${registration.starterModules.length} starter modules, ${registration.starterHumans.length} starter humans`,
    );
    return context.json<RegistrationCreateResponse>(
      {
        registration: {
          displayName: body.displayName,
          habitatUuid,
          habitatId: registration.habitatId,
          starterModules: registration.starterModules.length,
          blueprints: registration.blueprints.length,
        },
      },
      201,
    );
  });

  app.get("/status", async (context) => {
    const state = store.readState();

    if (!state.kepler) {
      logLine(options.logger, "[habitat-api] GET /status -> not registered");
      return context.json<ApiErrorResponse>(createErrorResponse("This CLI has not been registered with Kepler yet."), 404);
    }

    const response = await keplerRequest(`/habitats/${state.kepler.habitatId}/registration`, {
      method: "GET",
    });

    if (!response.ok) {
      const message = (await response.text()).trim() || "Unable to load habitat registration status from Kepler.";
      return context.json<ApiErrorResponse>(createErrorResponse(`Kepler request failed: ${response.status} ${message}`), 502);
    }

    const registrationResponse = (await response.json()) as KeplerHabitatResponse;
    const remoteHabitat = registrationResponse.habitat;

    state.kepler = {
      ...state.kepler,
      displayName: remoteHabitat.displayName,
      habitatId: remoteHabitat.id,
      habitatSlug: remoteHabitat.habitatSlug,
      status: remoteHabitat.status,
      catalogVersion: remoteHabitat.catalogVersion,
      lastSeenAt: remoteHabitat.lastSeenAt ?? null,
    };
    store.writeState(state);

    logLine(options.logger, `[habitat-api] GET /status -> ${remoteHabitat.status}`);
    return context.json<RegistrationStatusResponse>({
      registration: {
        displayName: state.kepler.displayName,
        habitatUuid: state.kepler.habitatUuid,
        habitatId: state.kepler.habitatId,
        baseUrl: state.kepler.baseUrl,
        habitatSlug: state.kepler.habitatSlug,
        status: state.kepler.status,
        catalogVersion: state.kepler.catalogVersion,
        lastSeenAt: state.kepler.lastSeenAt ?? null,
        starterModules: state.kepler.starterModules.length,
        blueprints: state.kepler.blueprints.length,
        localModules: state.modules?.length ?? 0,
      },
    });
  });

  app.delete("/registration", async (context) => {
    const state = store.readState();

    if (!state.kepler) {
      return context.json<ApiErrorResponse>(createErrorResponse("This CLI has not been registered with Kepler yet."), 404);
    }

    const deletedDisplayName = state.kepler.displayName;
    const response = await keplerRequest(`/habitats/${state.kepler.habitatId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const message = (await response.text()).trim() || "Unable to unregister from Kepler.";
      return context.json<ApiErrorResponse>(createErrorResponse(`Kepler request failed: ${response.status} ${message}`), 502);
    }

    delete state.kepler;
    store.deleteStateIfEmpty(state);

    logLine(options.logger, "[habitat-api] DELETE /registration -> removed");
    return context.json<RegistrationDeleteResponse>({
      registration: {
        displayName: deletedDisplayName,
        status: "Removed from Kepler",
      },
    });
  });

  app.get("/catalog/blueprints", async (context) => {
    try {
      const blueprints = await fetchBlueprintCatalog({
        baseUrl: keplerBaseUrl,
        headers: {
          Authorization: `Bearer ${keplerToken}`,
          "Content-Type": "application/json",
        },
        fetchImpl: async (input, init) => keplerRequest(new URL(String(input)).pathname, init ?? { method: "GET" }),
      });

      logLine(options.logger, `[habitat-api] GET /catalog/blueprints -> ${blueprints.length} blueprints`);
      return context.json<BlueprintCatalogResponse>({
        blueprints,
      });
    } catch (error) {
      return context.json<ApiErrorResponse>(createErrorResponse((error as Error).message), 502);
    }
  });

  app.get("/catalog/blueprints/:blueprintId", async (context) => {
    const blueprintId = context.req.param("blueprintId");

    try {
      const blueprint = await fetchBlueprintDetails({
        baseUrl: keplerBaseUrl,
        headers: {
          Authorization: `Bearer ${keplerToken}`,
          "Content-Type": "application/json",
        },
        blueprintId,
        fetchImpl: async (input, init) => keplerRequest(new URL(String(input)).pathname, init ?? { method: "GET" }),
      });

      logLine(options.logger, `[habitat-api] GET /catalog/blueprints/${blueprintId} -> found`);
      return context.json<BlueprintDetailsResponse>({
        blueprint,
      });
    } catch (error) {
      const message = (error as Error).message;
      const status = message.includes("was not found") ? 404 : 502;
      return context.json<ApiErrorResponse>(createErrorResponse(message), status);
    }
  });

  app.get("/catalog/resources", async (context) => {
    try {
      const resources = await fetchResourceCatalog({
        baseUrl: keplerBaseUrl,
        headers: {
          Authorization: `Bearer ${keplerToken}`,
          "Content-Type": "application/json",
        },
        fetchImpl: async (input, init) => keplerRequest(new URL(String(input)).pathname, init ?? { method: "GET" }),
      });

      logLine(options.logger, `[habitat-api] GET /catalog/resources -> ${resources.length} resources`);
      return context.json<ResourceCatalogResponse>({
        resources,
      });
    } catch (error) {
      return context.json<ApiErrorResponse>(createErrorResponse((error as Error).message), 502);
    }
  });

  app.get("/solar/irradiance", async (context) => {
    try {
      const solarIrradiance = await fetchSolarIrradiance({
        baseUrl: keplerBaseUrl,
        headers: {
          Authorization: `Bearer ${keplerToken}`,
          "Content-Type": "application/json",
        },
        fetchImpl: async (input, init) => keplerRequest(new URL(String(input)).pathname, init ?? { method: "GET" }),
      });

      logLine(options.logger, `[habitat-api] GET /solar/irradiance -> ${solarIrradiance.wPerM2} W/m^2`);
      return context.json<SolarIrradianceResponse>({
        solarIrradiance,
      });
    } catch (error) {
      return context.json<ApiErrorResponse>(createErrorResponse((error as Error).message), 502);
    }
  });

  app.get("/scan", async (context) => {
    const state = store.readState();

    if (!state.kepler) {
      return context.json<ApiErrorResponse>(createErrorResponse("This CLI has not been registered with Kepler yet."), 404);
    }

    const strength = parseIntegerQueryValue(context.req.query("strength"));
    if (strength === null || strength < 0 || strength > 100) {
      return context.json<ApiErrorResponse>(createErrorResponse("strength must be an integer from 0 through 100."), 400);
    }

    const radius = parseIntegerQueryValue(context.req.query("radius")) ?? 0;
    if (radius < 0 || radius > 5) {
      return context.json<ApiErrorResponse>(createErrorResponse("radius must be an integer from 0 through 5."), 400);
    }

    const eva = getEvaState(state);
    if (!eva.deployedHumanId || !eva.position) {
      return context.json<ApiErrorResponse>(createErrorResponse("No human is currently deployed for EVA."), 409);
    }

    const searchParams = new URLSearchParams({
      habitatId: state.kepler.habitatId,
      x: String(eva.position.x),
      y: String(eva.position.y),
      sensorStrength: String(strength),
      radiusTiles: String(radius),
    });

    const path = `/world/scan?${searchParams.toString()}`;
    const response = await keplerRequest(path, {
      method: "GET",
    });

    if (!response.ok) {
      const message = (await response.text()).trim() || "Unable to scan Kepler resources.";
      return context.json<ApiErrorResponse>(createErrorResponse(`Kepler request failed: ${response.status} ${message}`), 502);
    }

    const payload = (await response.json()) as ResourceScanResponse;

    logLine(options.logger, `[habitat-api] GET /scan -> ${payload.scan.tiles.length} tiles`);
    return context.json<ResourceScanResponse>(payload);
  });

  app.get("/modules", (context) => {
    const state = store.readState();
    const modules = state.modules ?? [];

    logLine(options.logger, `[habitat-api] GET /modules -> ${modules.length} modules`);
    return context.json<ModuleListResponse>({
      modules,
    });
  });

  app.get("/modules/:moduleId", (context) => {
    const state = store.readState();
    const moduleId = context.req.param("moduleId");
    const module = findModuleById(state.modules, moduleId);

    if (!module) {
      return context.json<ApiErrorResponse>(createErrorResponse(`Module "${moduleId}" was not found.`), 404);
    }

    logLine(options.logger, `[habitat-api] GET /modules/${moduleId} -> found`);
    return context.json<ModuleResponse>({
      module,
    });
  });

  app.post("/modules", async (context) => {
    const state = store.readState();
    const body = (await context.req.json()) as {
      blueprintId?: unknown;
      name?: unknown;
    };

    if (typeof body.blueprintId !== "string" || body.blueprintId.trim().length === 0) {
      return context.json<ApiErrorResponse>(createErrorResponse("blueprintId is required."), 400);
    }

    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return context.json<ApiErrorResponse>(createErrorResponse("name is required."), 400);
    }

    const blueprint = state.kepler?.blueprints.find((entry) => entry.blueprintId === body.blueprintId);

    if (!blueprint) {
      return context.json<ApiErrorResponse>(
        createErrorResponse(`Blueprint "${body.blueprintId}" was not found in local Kepler registration data.`),
        404,
      );
    }

    if (blueprint.output?.itemType !== "module") {
      return context.json<ApiErrorResponse>(
        createErrorResponse(`Blueprint "${body.blueprintId}" does not create a module.`),
        400,
      );
    }

    const module: ModuleRecord = {
      id: createNextLocalModuleId(state.modules, blueprint.blueprintId),
      blueprintId: blueprint.blueprintId,
      displayName: body.name,
      connectedTo: [],
      runtimeAttributes: { ...(blueprint.runtimeAttributes ?? {}) },
      capabilities: [...(blueprint.capabilities ?? [])],
    };

    state.modules = [...(state.modules ?? []), module];
    store.writeState(state);

    logLine(options.logger, `[habitat-api] POST /modules -> created ${module.id}`);
    return context.json<ModuleResponse>(
      {
        module,
      },
      201,
    );
  });

  app.patch("/modules/:moduleId", async (context) => {
    const state = store.readState();
    const moduleId = context.req.param("moduleId");
    const module = findModuleById(state.modules, moduleId);

    if (!module) {
      return context.json<ApiErrorResponse>(createErrorResponse(`Module "${moduleId}" was not found.`), 404);
    }

    const body = (await context.req.json()) as {
      name?: unknown;
      status?: unknown;
      health?: unknown;
    };

    if (body.name !== undefined) {
      if (typeof body.name !== "string" || body.name.trim().length === 0) {
        return context.json<ApiErrorResponse>(createErrorResponse("name must be a non-empty string."), 400);
      }

      module.displayName = body.name;
    }

    if (body.status !== undefined) {
      if (typeof body.status !== "string" || !isModuleRuntimeStatus(body.status)) {
        return context.json<ApiErrorResponse>(createErrorResponse("status must be a valid module runtime status."), 400);
      }

      module.runtimeAttributes.status = body.status;
    }

    if (body.health !== undefined) {
      if (typeof body.health !== "number" || Number.isNaN(body.health)) {
        return context.json<ApiErrorResponse>(createErrorResponse("health must be a number."), 400);
      }

      module.runtimeAttributes.health = body.health;
    }

    store.writeState(state);

    logLine(options.logger, `[habitat-api] PATCH /modules/${moduleId} -> updated`);
    return context.json<ModuleResponse>({
      module,
    });
  });

  app.delete("/modules/:moduleId", (context) => {
    const state = store.readState();
    const moduleId = context.req.param("moduleId");
    const module = findModuleById(state.modules, moduleId);

    if (!module) {
      return context.json<ApiErrorResponse>(createErrorResponse(`Module "${moduleId}" was not found.`), 404);
    }

    const occupyingHuman = (state.humans ?? []).find((human) => human.locationModuleId === module.id);
    if (occupyingHuman) {
      return context.json<ApiErrorResponse>(
        createErrorResponse(`Module "${moduleId}" cannot be deleted while occupied by human "${occupyingHuman.id}".`),
        409,
      );
    }

    state.modules = (state.modules ?? []).filter((entry) => entry.id !== module.id);

    for (const entry of state.modules) {
      entry.connectedTo = entry.connectedTo.filter((connectionId) => connectionId !== module.id);
    }

    store.deleteStateIfEmpty(state);

    logLine(options.logger, `[habitat-api] DELETE /modules/${moduleId} -> deleted`);
    return context.json<ModuleResponse>({
      module,
    });
  });

  app.get("/humans", (context) => {
    const state = store.readState();
    const humans = state.humans ?? [];

    logLine(options.logger, `[habitat-api] GET /humans -> ${humans.length} humans`);
    return context.json<HumanListResponse>({
      humans,
    });
  });

  app.get("/eva", (context) => {
    const state = store.readState();
    const eva = getEvaState(state);

    logLine(options.logger, `[habitat-api] GET /eva -> ${eva.deployedHumanId ?? "none"}`);
    return context.json<EvaResponse>({
      eva,
    });
  });

  app.post("/eva/deploy", async (context) => {
    const state = store.readState();
    const body = (await context.req.json()) as {
      humanId?: unknown;
    };

    if (typeof body.humanId !== "string" || body.humanId.trim().length === 0) {
      return context.json<ApiErrorResponse>(createErrorResponse("humanId is required."), 400);
    }

    if (!state.kepler) {
      return context.json<ApiErrorResponse>(createErrorResponse("This CLI has not been registered with Kepler yet."), 404);
    }

    try {
      await getCurrentSectorBounds(state.kepler.habitatId);
      const eva = deployHumanForEva(state, body.humanId);
      openOrUpdateAlert(
        state,
        {
          code: "eva-human-deployed",
          title: "Human Deployed",
          description: "A human is outside the habitat.",
          severity: "warning",
          status: "open",
          source: "eva",
          subject: {
            type: "human",
            id: body.humanId,
          },
        },
        new Date().toISOString(),
      );
      store.writeState(state);

      logLine(options.logger, `[habitat-api] POST /eva/deploy -> ${body.humanId}`);
      return context.json<EvaResponse>({ eva });
    } catch (error) {
      return context.json<ApiErrorResponse>(createErrorResponse((error as Error).message), 409);
    }
  });

  app.post("/eva/move", async (context) => {
    const state = store.readState();

    if (!state.kepler) {
      return context.json<ApiErrorResponse>(createErrorResponse("This CLI has not been registered with Kepler yet."), 404);
    }

    const body = (await context.req.json()) as {
      x?: unknown;
      y?: unknown;
    };

    if (typeof body.x !== "number" || !Number.isInteger(body.x) || typeof body.y !== "number" || !Number.isInteger(body.y)) {
      return context.json<ApiErrorResponse>(createErrorResponse("x and y must be whole numbers."), 400);
    }

    try {
      const bounds = await getCurrentSectorBounds(state.kepler.habitatId);
      const eva = moveEva(state, body.x, body.y, bounds);
      store.writeState(state);

      logLine(options.logger, `[habitat-api] POST /eva/move -> (${body.x}, ${body.y})`);
      return context.json<EvaResponse>({ eva });
    } catch (error) {
      return context.json<ApiErrorResponse>(createErrorResponse((error as Error).message), 409);
    }
  });

  app.post("/eva/dock", (context) => {
    const state = store.readState();
    const eva = getEvaState(state);

    try {
      ensureDockable(eva);
      const now = new Date().toISOString();
      const returnedHumanId = eva.deployedHumanId;
      const suitportModuleId = eva.suitportModuleId;

      state.inventory = state.inventory ?? {};
      for (const resource of eva.carriedResources) {
        state.inventory[resource.resourceType] = (state.inventory[resource.resourceType] ?? 0) + resource.quantityKg;
      }

      if (returnedHumanId && suitportModuleId) {
        const human = findHumanById(state.humans, returnedHumanId);
        if (human) {
          human.locationModuleId = suitportModuleId;
        }
      }

      resolveAlertByCode(
        state,
        "eva-human-deployed",
        now,
        returnedHumanId
          ? {
              type: "human",
              id: returnedHumanId,
            }
          : undefined,
      );
      if (returnedHumanId) {
        resolveAlertByCode(state, "eva-carry-capacity-reached", now, {
          type: "human",
          id: returnedHumanId,
        });
      }

      state.eva = {
        deployedHumanId: null,
        suitportModuleId: null,
        position: null,
        carriedResources: [],
        carryCapacityKg: eva.carryCapacityKg,
      };
      store.writeState(state);

      logLine(options.logger, `[habitat-api] POST /eva/dock -> ${returnedHumanId}`);
      return context.json<EvaResponse>({ eva: state.eva });
    } catch (error) {
      return context.json<ApiErrorResponse>(createErrorResponse((error as Error).message), 409);
    }
  });

  app.post("/collect", async (context) => {
    const state = store.readState();

    if (!state.kepler) {
      return context.json<ApiErrorResponse>(createErrorResponse("This CLI has not been registered with Kepler yet."), 404);
    }

    const eva = getEvaState(state);
    if (!eva.deployedHumanId || !eva.position) {
      return context.json<ApiErrorResponse>(createErrorResponse("No human is currently deployed for EVA."), 409);
    }

    const body = (await context.req.json()) as {
      quantityKg?: unknown;
    };

    let quantityKg: number;
    try {
      quantityKg = validateCollectionQuantity(body.quantityKg);
      ensureCarryCapacity(eva, quantityKg);
    } catch (error) {
      return context.json<ApiErrorResponse>(createErrorResponse((error as Error).message), 409);
    }

    const response = await keplerRequest("/world/collect", {
      method: "POST",
      body: JSON.stringify({
        habitatId: state.kepler.habitatId,
        x: eva.position.x,
        y: eva.position.y,
        quantityKg,
      }),
    });

    if (!response.ok) {
      const responseText = (await response.text()).trim();
      let message = responseText || "Unable to collect Kepler material.";
      if (responseText.startsWith("{")) {
        try {
          const parsed = JSON.parse(responseText) as ApiErrorResponse;
          message = parsed.error.message;
        } catch {
          message = responseText;
        }
      }
      openOrUpdateAlert(
        state,
        {
          code: "eva-collection-failed",
          title: "Collection Failed",
          description: message,
          severity: "warning",
          status: "open",
          source: "collection",
          subject: eva.deployedHumanId
            ? {
                type: "human",
                id: eva.deployedHumanId,
              }
            : undefined,
        },
        new Date().toISOString(),
      );
      store.writeState(state);
      const status = response.status >= 500 ? 502 : response.status === 404 ? 404 : response.status === 400 ? 400 : 409;
      return context.json<ApiErrorResponse>(createErrorResponse(`Kepler request failed: ${response.status} ${message}`), status);
    }

    const payload = (await response.json()) as CollectionResponse;
    addCarriedResource(eva, payload.collection);
    state.eva = eva;
    if (eva.deployedHumanId && eva.carriedResources.reduce((total, resource) => total + resource.quantityKg, 0) >= eva.carryCapacityKg) {
      openOrUpdateAlert(
        state,
        {
          code: "eva-carry-capacity-reached",
          title: "EVA Carry Capacity Reached",
          description: "The deployed explorer has reached EVA carrying capacity.",
          severity: "warning",
          status: "open",
          source: "collection",
          subject: {
            type: "human",
            id: eva.deployedHumanId,
          },
        },
        new Date().toISOString(),
      );
    }
    store.writeState(state);

    logLine(options.logger, `[habitat-api] POST /collect -> ${payload.collection.resourceType} ${payload.collection.collectedKg} kg`);
    return context.json<CollectionResponse>({
      collection: payload.collection,
      eva,
    });
  });

  app.get("/alerts", (context) => {
    const state = store.readState();
    const alerts = listAlerts(state);

    logLine(options.logger, `[habitat-api] GET /alerts -> ${alerts.length} alerts`);
    return context.json<AlertListResponse>({
      alerts,
    });
  });

  app.post("/alerts/:alertId/acknowledge", (context) => {
    const state = store.readState();
    const alertId = context.req.param("alertId");

    try {
      const alert = acknowledgeAlert(state, alertId, new Date().toISOString());
      store.writeState(state);

      logLine(options.logger, `[habitat-api] POST /alerts/${alertId}/acknowledge -> ${alert.status}`);
      return context.json<AlertResponse>({
        alert,
      });
    } catch (error) {
      return context.json<ApiErrorResponse>(createErrorResponse((error as Error).message), 404);
    }
  });

  app.post("/humans/:humanId/move", async (context) => {
    const state = store.readState();
    const humanId = context.req.param("humanId");
    const human = findHumanById(state.humans, humanId);

    if (!human) {
      return context.json<ApiErrorResponse>(createErrorResponse(`Human "${humanId}" was not found.`), 404);
    }

    const body = (await context.req.json()) as {
      destinationModuleId?: unknown;
    };

    if (typeof body.destinationModuleId !== "string" || body.destinationModuleId.trim().length === 0) {
      return context.json<ApiErrorResponse>(createErrorResponse("destinationModuleId is required."), 400);
    }

    const destinationModule = findModuleById(state.modules, body.destinationModuleId);
    if (!destinationModule) {
      return context.json<ApiErrorResponse>(
        createErrorResponse(`Module "${body.destinationModuleId}" was not found.`),
        404,
      );
    }

    if (!canMoveHumanToModule(state.humans, destinationModule, human.id)) {
      return context.json<ApiErrorResponse>(
        createErrorResponse(`Module "${destinationModule.id}" is already at full crew capacity.`),
        409,
      );
    }

    human.locationModuleId = destinationModule.id;
    store.writeState(state);

    logLine(options.logger, `[habitat-api] POST /humans/${humanId}/move -> ${destinationModule.id}`);
    return context.json<HumanResponse>({
      human,
    });
  });

  app.get("/inventory", (context) => {
    const state = store.readState();
    const inventory = state.inventory ?? {};

    logLine(options.logger, `[habitat-api] GET /inventory -> ${Object.keys(inventory).length} resources`);
    return context.json<InventoryResponse>({
      inventory,
    });
  });

  app.put("/inventory/:resourceId", async (context) => {
    const state = store.readState();
    const resourceId = context.req.param("resourceId");
    const body = (await context.req.json()) as {
      delta?: unknown;
    };

    if (typeof body.delta !== "number" || !Number.isFinite(body.delta) || body.delta === 0) {
      return context.json<ApiErrorResponse>(createErrorResponse("delta must be a non-zero number."), 400);
    }

    const result =
      body.delta > 0
        ? addInventoryResource(state, resourceId, body.delta)
        : removeInventoryResource(state, resourceId, Math.abs(body.delta));

    store.writeState(state);

    logLine(
      options.logger,
      `[habitat-api] PUT /inventory/${resourceId} -> ${result.previousAmount} to ${result.newAmount}`,
    );
    return context.json<InventoryMutationResponse>({
      resourceId: result.resourceId,
      previousAmount: result.previousAmount,
      newAmount: result.newAmount,
    });
  });

  app.get("/state", (context) => {
    const state = store.readState();

    logLine(
      options.logger,
      `[habitat-api] GET /state -> ${state.modules?.length ?? 0} modules, tick ${state.simulation?.currentTick ?? 0}`,
    );
    return context.json<LocalStateResponse>({
      state,
    });
  });

  app.put("/state", async (context) => {
    const body = (await context.req.json()) as {
      state?: import("./local-state.js").LocalState;
    };

    if (!body.state || typeof body.state !== "object") {
      return context.json<ApiErrorResponse>(createErrorResponse("state is required."), 400);
    }

    store.writeState(body.state);

    logLine(
      options.logger,
      `[habitat-api] PUT /state -> ${body.state.modules?.length ?? 0} modules, tick ${body.state.simulation?.currentTick ?? 0}`,
    );
    return context.json<LocalStateResponse>({
      state: body.state,
    });
  });

  return app;
}
