import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Hono } from "hono";
import { fetchBlueprintCatalog, fetchBlueprintDetails, type BlueprintRecord } from "./blueprints.js";
import { getEffectiveInventory } from "./construction.js";
import { cloneModule, type HabitatRegistrationRecord } from "./local-state.js";
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

export type InventoryResponse = {
  inventory: Record<string, number>;
};

export type InventoryMutationResponse = {
  resourceId: string;
  previousAmount: number;
  newAmount: number;
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
  starterModules: ModuleRecord[];
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
      starterModules: registration.starterModules,
      blueprints: registration.blueprints as HabitatRegistrationRecord["blueprints"],
    };
    state.inventory = getEffectiveInventory(state);
    state.modules = registration.starterModules.map(cloneModule);
    store.writeState(state);

    logLine(options.logger, `[habitat-api] POST /registration -> ${registration.starterModules.length} starter modules`);
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

    const x = parseIntegerQueryValue(context.req.query("x"));
    if (x === null) {
      return context.json<ApiErrorResponse>(createErrorResponse("x must be an integer."), 400);
    }

    const y = parseIntegerQueryValue(context.req.query("y"));
    if (y === null) {
      return context.json<ApiErrorResponse>(createErrorResponse("y must be an integer."), 400);
    }

    const strength = parseIntegerQueryValue(context.req.query("strength"));
    if (strength === null || strength < 0 || strength > 100) {
      return context.json<ApiErrorResponse>(createErrorResponse("strength must be an integer from 0 through 100."), 400);
    }

    const radius = parseIntegerQueryValue(context.req.query("radius")) ?? 0;
    if (radius < 0 || radius > 5) {
      return context.json<ApiErrorResponse>(createErrorResponse("radius must be an integer from 0 through 5."), 400);
    }

    const searchParams = new URLSearchParams({
      habitatId: state.kepler.habitatId,
      x: String(x),
      y: String(y),
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
