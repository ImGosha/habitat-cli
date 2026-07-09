#!/usr/bin/env bun

import { Command, CommanderError } from "commander";
import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import {
  fetchBlueprintCatalog,
  fetchBlueprintDetails,
  formatBlueprintDetails,
  formatBlueprintList,
  type BlueprintRecord,
} from "./blueprints.js";
import {
  advanceConstructionJobs,
  cancelConstruction,
  formatConstructionStatus,
  getEffectiveInventory,
  previewConstruction,
  startConstruction,
} from "./construction.js";
import {
  formatBoolean,
  formatExamples,
  formatKeyValueRows,
  formatList,
  formatRecordTable,
  formatSection,
  formatTable,
  formatUnknownValue,
} from "./cli-format.js";
import { addInventoryResource, formatInventoryList } from "./inventory.js";
import { createNextLocalModuleId } from "./local-module-ids.js";
import { fetchResourceCatalog, formatResourceList } from "./resources.js";
import { fetchSolarIrradiance, formatSolarStatus } from "./solar.js";
import {
  findModuleById,
  formatModuleList,
  getShortModuleId,
  isModuleRuntimeStatus,
  moduleRuntimeStatuses,
  setModuleRuntimeStatus,
  type ModuleRecord,
} from "./modules.js";
import { formatModulePowerStatusTable, getModulePowerDrawKw, runPowerSimulation } from "./power.js";

type HabitatRegistrationRecord = {
  baseUrl: string;
  displayName: string;
  habitatUuid: string;
  habitatId: string;
  habitatSlug?: string;
  status?: string;
  catalogVersion?: string;
  lastSeenAt?: string | null;
  starterModules: ModuleRecord[];
  blueprints: BlueprintRecord[];
};

type LocalState = {
  kepler?: HabitatRegistrationRecord;
  inventory?: Record<string, number>;
  modules?: ModuleRecord[];
  simulation?: {
    currentTick?: number;
    lastTickAt?: string;
    lastPowerDrawKw?: number;
    lastEnergyRequestedKwh?: number;
    lastEnergyDrainedKwh?: number;
    lastPowerShortfallKwh?: number;
  };
} & Record<string, unknown>;

type RegisterOptions = {
  name: string;
};

type KeplerRegistrationRequest = {
  displayName: string;
  habitatUuid: string;
};

type KeplerRegistrationResponse = {
  habitatId: string;
  starterModules: ModuleRecord[];
  blueprints: BlueprintRecord[];
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

type ModuleCreateOptions = {
  blueprintId: string;
  name: string;
};

type ModuleUpdateOptions = {
  name?: string;
  status?: string;
  health?: string;
};

type ConstructOptions = {
  dryRun?: boolean;
};

const version = "0.1.0";
const defaultKeplerBaseUrl = "https://planet.turingguild.com";

function findProjectRootPath(): string {
  let currentPath = process.cwd();

  while (true) {
    if (existsSync(join(currentPath, "package.json")) && existsSync(join(currentPath, "src"))) {
      return currentPath;
    }

    const parentPath = dirname(currentPath);

    if (parentPath === currentPath) {
      return process.cwd();
    }

    currentPath = parentPath;
  }
}

const projectRootPath = findProjectRootPath();
dotenv.config({ path: join(projectRootPath, ".env"), quiet: true });
const dataFilePath = join(projectRootPath, "habitat.json");

function exampleBlock(lines: string[]): string {
  return `\n${formatExamples(lines)}\n`;
}

function sectionBlock(title: string, lines: string[]): string {
  return `\n${formatSection(title, lines.map((line) => `- ${line}`).join("\n"))}\n`;
}

function getKeplerBaseUrl(): string {
  return process.env.KEPLER_BASE_URL ?? defaultKeplerBaseUrl;
}

function getKeplerToken(): string {
  const token = process.env.KEPLER_PLANET_TOKEN;

  if (!token) {
    console.error("Missing KEPLER_PLANET_TOKEN in .env.");
    process.exit(1);
  }

  return token;
}

function getKeplerHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${getKeplerToken()}`,
    "Content-Type": "application/json",
  };
}

function cloneModule(module: ModuleRecord): ModuleRecord {
  return {
    ...module,
    connectedTo: [...module.connectedTo],
    runtimeAttributes: { ...module.runtimeAttributes },
    capabilities: [...module.capabilities],
  };
}

function normalizeState(state: LocalState): LocalState {
  if (!Array.isArray(state.modules) && state.kepler?.starterModules) {
    return {
      ...state,
      modules: state.kepler.starterModules.map(cloneModule),
    };
  }

  return state;
}

async function keplerRequest(path: string, init: RequestInit): Promise<Response> {
  const response = await fetch(`${getKeplerBaseUrl()}${path}`, init);

  if (response.ok) {
    return response;
  }

  const responseBody = await response.text();
  const message = responseBody.trim() || response.statusText;
  console.error(`Kepler request failed: ${response.status} ${message}`);
  process.exit(1);
}

async function ensureDataDir(): Promise<void> {
  await mkdir(dirname(dataFilePath), { recursive: true });
}

async function readState(): Promise<LocalState> {
  try {
    const raw = await readFile(dataFilePath, "utf8");
    const parsed = JSON.parse(raw) as LocalState;
    return typeof parsed === "object" && parsed !== null ? normalizeState(parsed) : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

async function readAndPersistState(): Promise<LocalState> {
  const state = await readState();
  await writeState(state);
  return state;
}

async function writeState(state: LocalState): Promise<void> {
  await ensureDataDir();
  await writeFile(dataFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function deleteDataFileIfEmpty(state: LocalState): Promise<void> {
  const meaningfulKeys = Object.keys(state).filter((key) => state[key] !== undefined);

  if (meaningfulKeys.length > 0) {
    await writeState(state);
    return;
  }

  try {
    await rm(dataFilePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

function formatRegistrationStatus(registration: HabitatRegistrationRecord, moduleCount: number): string {
  return formatSection(
    "Habitat Registration",
    formatKeyValueRows([
      ["Display Name", registration.displayName],
      ["Habitat UUID", registration.habitatUuid],
      ["Habitat ID", registration.habitatId],
      ["Base URL", registration.baseUrl],
      ["Habitat Slug", registration.habitatSlug ?? "Unknown"],
      ["Status", registration.status ?? "Unknown"],
      ["Catalog Version", registration.catalogVersion ?? "Unknown"],
      ["Last Seen At", registration.lastSeenAt ?? "Unknown"],
      ["Starter Modules", String(registration.starterModules.length)],
      ["Blueprints", String(registration.blueprints.length)],
      ["Local Modules", String(moduleCount)],
    ]),
  );
}

function formatModuleDetails(module: ModuleRecord): string {
  const summary = formatKeyValueRows([
    ["ID", module.id],
    ["Short ID", getShortModuleId(module)],
    ["Display Name", module.displayName],
    ["Blueprint ID", module.blueprintId],
    ["Status", String(module.runtimeAttributes.status ?? "Unknown")],
    ["Health", String(module.runtimeAttributes.health ?? "Unknown")],
  ]);
  const relationships = formatKeyValueRows([
    ["Connected To", module.connectedTo.length > 0 ? module.connectedTo.join(", ") : "None"],
    ["Capabilities", module.capabilities.length > 0 ? module.capabilities.join(", ") : "None"],
  ]);
  const runtimeAttributes = formatRecordTable(module.runtimeAttributes, "Attribute", "Value");

  return [
    formatSection("Module Summary", summary),
    formatSection("Relationships", relationships),
    formatSection("Runtime Attributes", runtimeAttributes),
  ].join("\n\n");
}

function findBlueprint(state: LocalState, blueprintId: string): BlueprintRecord | undefined {
  return state.kepler?.blueprints.find((blueprint) => blueprint.blueprintId === blueprintId);
}

function formatEnergy(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function getBlueprintInputInventory(blueprint: BlueprintRecord): Record<string, number> {
  const inventory: Record<string, number> = {};

  if (!blueprint.inputs || typeof blueprint.inputs !== "object" || Array.isArray(blueprint.inputs)) {
    return inventory;
  }

  for (const [resourceType, quantity] of Object.entries(blueprint.inputs)) {
    if (typeof quantity === "number" && Number.isFinite(quantity) && quantity > 0) {
      inventory[resourceType] = quantity;
    }
  }

  return inventory;
}

function formatInventorySection(title: string, inventory: Record<string, number>): string {
  return formatSection(title, formatInventoryList(inventory));
}

function formatResultSummary(title: string, rows: Array<[string, string]>, notes: string[] = []): string {
  const sections = [formatSection(title, formatKeyValueRows(rows))];

  if (notes.length > 0) {
    sections.push(formatSection("Notes", formatList(notes)));
  }

  return sections.join("\n\n");
}

function parseTickCount(count: string): number {
  const tickCount = Number(count);

  if (!Number.isInteger(tickCount) || tickCount <= 0) {
    console.error("Tick count must be a positive whole number.");
    process.exit(1);
  }

  return tickCount;
}

async function registerHabitat(options: RegisterOptions): Promise<void> {
  const state = await readState();

  if (state.kepler) {
    console.error(`This CLI is already registered with Kepler as "${state.kepler.displayName}".`);
    process.exit(1);
  }

  const requestBody: KeplerRegistrationRequest = {
    displayName: options.name,
    habitatUuid: randomUUID(),
  };

  const response = await keplerRequest("/habitats/register", {
    method: "POST",
    headers: getKeplerHeaders(),
    body: JSON.stringify(requestBody),
  });

  const registration = (await response.json()) as KeplerRegistrationResponse;

  state.kepler = {
    baseUrl: getKeplerBaseUrl(),
    displayName: requestBody.displayName,
    habitatUuid: requestBody.habitatUuid,
    habitatId: registration.habitatId,
    starterModules: registration.starterModules,
    blueprints: registration.blueprints,
  };
  state.inventory = getEffectiveInventory(state);
  state.modules = registration.starterModules.map(cloneModule);

  await writeState(state);
  console.log(
    formatResultSummary("Registration Complete", [
      ["Display Name", requestBody.displayName],
      ["Habitat ID", registration.habitatId],
      ["Starter Modules", String(registration.starterModules.length)],
      ["Blueprints", String(registration.blueprints.length)],
    ]),
  );
}

async function showHabitatRegistrationStatus(): Promise<void> {
  const state = await readAndPersistState();

  if (!state.kepler) {
    console.error("This CLI has not been registered with Kepler yet.");
    process.exit(1);
  }

  const response = await keplerRequest(`/habitats/${state.kepler.habitatId}/registration`, {
    method: "GET",
    headers: getKeplerHeaders(),
  });

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

  await writeState(state);
  console.log(formatRegistrationStatus(state.kepler, state.modules?.length ?? 0));
}

async function unregisterHabitat(): Promise<void> {
  const state = await readState();

  if (!state.kepler) {
    console.error("This CLI has not been registered with Kepler yet.");
    process.exit(1);
  }

  await keplerRequest(`/habitats/${state.kepler.habitatId}`, {
    method: "DELETE",
    headers: getKeplerHeaders(),
  });

  const deletedDisplayName = state.kepler.displayName;
  delete state.kepler;
  await deleteDataFileIfEmpty(state);

  console.log(
    formatResultSummary("Unregistration Complete", [
      ["Display Name", deletedDisplayName],
      ["Status", "Removed from Kepler"],
    ]),
  );
}

async function listBlueprints(): Promise<void> {
  try {
    const blueprints = await fetchBlueprintCatalog({
      baseUrl: getKeplerBaseUrl(),
      headers: getKeplerHeaders(),
    });

    console.log(formatBlueprintList(blueprints));
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

async function showBlueprint(blueprintId: string): Promise<void> {
  try {
    const blueprint = await fetchBlueprintDetails({
      baseUrl: getKeplerBaseUrl(),
      headers: getKeplerHeaders(),
      blueprintId,
    });

    console.log(formatBlueprintDetails(blueprint));
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

async function listResources(): Promise<void> {
  try {
    const resources = await fetchResourceCatalog({
      baseUrl: getKeplerBaseUrl(),
      headers: getKeplerHeaders(),
    });

    console.log(
      [
        formatSection(
          "Resource Catalog",
          formatList([
            "Possible resource types in the Kepler world.",
            "This is not your habitat's local inventory.",
            "Blueprint requirements will refer to these resource names later.",
          ]),
        ),
        formatResourceList(resources),
      ].join("\n\n"),
    );
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

async function showSolarStatus(): Promise<void> {
  try {
    const irradiance = await fetchSolarIrradiance({
      baseUrl: getKeplerBaseUrl(),
      headers: getKeplerHeaders(),
    });

    console.log(formatSolarStatus(irradiance));
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

async function constructBlueprint(blueprintId: string, options: ConstructOptions): Promise<void> {
  const state = await readState();

  try {
    const blueprint = await fetchBlueprintDetails({
      baseUrl: getKeplerBaseUrl(),
      headers: getKeplerHeaders(),
      blueprintId,
    });
    const preview = previewConstruction(state, blueprint);
    const requiredInventory = getBlueprintInputInventory(blueprint);

    if (options.dryRun) {
      console.log(
        [
          formatSection(
            "Construction Dry Run",
            formatKeyValueRows([
              ["Blueprint", blueprint.blueprintId],
              ["Facility", `${preview.facilityDisplayName} (${preview.facilityId})`],
              ["Output Module ID", preview.outputModuleId],
              ["Build Ticks", String(preview.totalTicks)],
            ]),
          ),
          formatSection(
            "Checks",
            formatTable(
              ["Check", "Result"],
              [
                ["Required Facility Exists", formatBoolean(preview.requiredFacilityExists)],
                ["Fabricator Available", formatBoolean(preview.facilityAvailable)],
                ["Supply Cache Online", formatBoolean(preview.supplyCacheOnline)],
                ["Prerequisites Met", formatBoolean(preview.prerequisitesMet)],
                ["Enough Local Inventory", formatBoolean(Object.keys(preview.missingResources).length === 0)],
                ["Construction Can Start", formatBoolean(preview.canStart)],
              ],
            ),
          ),
          formatInventorySection("Materials Required", requiredInventory),
          formatInventorySection("Inventory After", preview.inventoryAfter),
          formatSection("Notes", formatList(["No local files were changed."])),
        ].join("\n\n"),
      );
      return;
    }

    const startedJob = startConstruction(state, blueprint);
    await writeState(state);

    console.log(
      [
        formatResultSummary("Construction Started", [
          ["Blueprint", blueprint.blueprintId],
          ["Facility", `${preview.facilityDisplayName} (${startedJob.facilityId})`],
          ["Output Module ID", startedJob.outputModuleId],
          ["Remaining Ticks", String(startedJob.remainingTicks)],
        ]),
        formatInventorySection("Inventory After", state.inventory ?? {}),
      ].join("\n\n"),
    );
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

async function showConstructionStatus(): Promise<void> {
  const state = await readState();
  console.log(formatConstructionStatus(state.modules ?? []));
}

async function cancelConstructionCommand(facilityModuleId: string): Promise<void> {
  const state = await readState();
  const facility = findModuleById(state.modules, facilityModuleId);

  if (!facility) {
    console.error(`Module "${facilityModuleId}" was not found.`);
    process.exit(1);
  }

  try {
    const result = cancelConstruction(state, facility);
    await writeState(state);
    console.log(
      formatResultSummary(
        "Construction Canceled",
        [["Facility ID", result.facilityId]],
        ["Materials were not refunded."],
      ),
    );
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

async function listInventory(): Promise<void> {
  const state = await readState();
  console.log(formatInventoryList(state.inventory ?? {}));
}

async function addInventory(resourceId: string, amount: string): Promise<void> {
  const numericAmount = Number(amount);

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    console.error("amount must be a positive number.");
    process.exit(1);
  }

  const state = await readState();
  const result = addInventoryResource(state, resourceId, numericAmount);
  await writeState(state);

  console.log(
    formatResultSummary("Inventory Updated", [
      ["Resource", resourceId],
      ["Added", formatEnergy(numericAmount)],
      ["Previous Amount", formatEnergy(result.previousAmount)],
      ["New Amount", formatEnergy(result.newAmount)],
    ]),
  );
}

async function listModules(): Promise<void> {
  const state = await readAndPersistState();
  const modules = state.modules ?? [];
  console.log(formatModuleList(modules));
}

async function showModulePowerStatus(): Promise<void> {
  const state = await readAndPersistState();
  console.log(formatModulePowerStatusTable(state.modules ?? []));
}

async function showModule(moduleId: string): Promise<void> {
  const state = await readAndPersistState();
  const module = findModuleById(state.modules, moduleId);

  if (!module) {
    console.error(`Module "${moduleId}" was not found.`);
    process.exit(1);
  }

  console.log(formatModuleDetails(module));
}

async function setModuleStatus(moduleId: string, status: string): Promise<void> {
  if (!isModuleRuntimeStatus(status)) {
    console.error(`Status must be one of: ${moduleRuntimeStatuses.join(", ")}.`);
    process.exit(1);
  }

  const state = await readAndPersistState();
  const module = findModuleById(state.modules, moduleId);

  if (!module) {
    console.error(`Module "${moduleId}" was not found.`);
    process.exit(1);
  }

  setModuleRuntimeStatus(module, status);
  await writeState(state);

  console.log(
    formatResultSummary("Module Status Updated", [
      ["Module ID", getShortModuleId(module)],
      ["Status", status],
      ["Current Power Draw", `${formatEnergy(getModulePowerDrawKw(module))} kW`],
    ]),
  );
}

async function createModule(options: ModuleCreateOptions): Promise<void> {
  const state = await readAndPersistState();
  const blueprint = findBlueprint(state, options.blueprintId);

  if (!blueprint) {
    console.error(`Blueprint "${options.blueprintId}" was not found in local Kepler registration data.`);
    process.exit(1);
  }

  if (blueprint.output?.itemType !== "module") {
    console.error(`Blueprint "${options.blueprintId}" does not create a module.`);
    process.exit(1);
  }

  const module: ModuleRecord = {
    id: createNextLocalModuleId(state.modules, options.blueprintId),
    blueprintId: blueprint.blueprintId,
    displayName: options.name,
    connectedTo: [],
    runtimeAttributes: { ...(blueprint.runtimeAttributes ?? {}) },
    capabilities: [...(blueprint.capabilities ?? [])],
  };

  state.modules = [...(state.modules ?? []), module];
  await writeState(state);

  console.log(
    formatResultSummary("Module Created", [
      ["Display Name", module.displayName],
      ["Module ID", getShortModuleId(module)],
      ["Full ID", module.id],
      ["Blueprint", module.blueprintId],
    ]),
  );
}

async function updateModule(moduleId: string, options: ModuleUpdateOptions): Promise<void> {
  const state = await readAndPersistState();
  const module = findModuleById(state.modules, moduleId);

  if (!module) {
    console.error(`Module "${moduleId}" was not found.`);
    process.exit(1);
  }

  if (options.name !== undefined) {
    module.displayName = options.name;
  }

  if (options.status !== undefined) {
    module.runtimeAttributes.status = options.status;
  }

  if (options.health !== undefined) {
    const health = Number(options.health);

    if (Number.isNaN(health)) {
      console.error("health must be a number.");
      process.exit(1);
    }

    module.runtimeAttributes.health = health;
  }

  await writeState(state);
  console.log(
    formatResultSummary("Module Updated", [
      ["Module ID", getShortModuleId(module)],
      ["Display Name", module.displayName],
      ["Status", String(module.runtimeAttributes.status ?? "Unknown")],
      ["Health", String(module.runtimeAttributes.health ?? "Unknown")],
    ]),
  );
}

async function deleteModule(moduleId: string): Promise<void> {
  const state = await readAndPersistState();
  const module = findModuleById(state.modules, moduleId);

  if (!module) {
    console.error(`Module "${moduleId}" was not found.`);
    process.exit(1);
  }

  state.modules = (state.modules ?? []).filter((entry) => entry.id !== module.id);

  for (const entry of state.modules) {
    entry.connectedTo = entry.connectedTo.filter((connectionId) => connectionId !== module.id);
  }

  await deleteDataFileIfEmpty(state);
  console.log(
    formatResultSummary("Module Deleted", [
      ["Module ID", getShortModuleId(module)],
      ["Display Name", module.displayName],
    ]),
  );
}

async function runTicks(count: string): Promise<void> {
  const tickCount = parseTickCount(count);
  const state = await readAndPersistState();

  try {
    const result = await runPowerSimulation(state, tickCount, () =>
      fetchSolarIrradiance({
        baseUrl: getKeplerBaseUrl(),
        headers: getKeplerHeaders(),
      }),
    );
    const constructionResult = advanceConstructionJobs(state, tickCount);
    await writeState(state);

    const battery = findModuleById(state.modules, result.batteryId);
    const batteryLabel = battery ? getShortModuleId(battery) : result.batteryId;

    const sections = [
      formatSection(
        "Tick Summary",
        formatKeyValueRows([
          ["Ticks Advanced", String(result.tickCount)],
          ["Current Tick", String(result.currentTick)],
          ["Power Draw", `${formatEnergy(result.totalPowerDrawKw)} kW`],
          ["Energy Requested", `${formatEnergy(result.energyRequestedKwh)} kWh`],
          ["Energy Drained", `${formatEnergy(result.energyDrainedKwh)} kWh`],
          ["Power Shortfall", `${formatEnergy(result.powerShortfallKwh)} kWh`],
          ["Battery", batteryLabel],
          ["Battery Remaining", `${formatEnergy(result.batteryEnergyRemainingKwh)} kWh`],
          ["Solar Generated", `${formatEnergy(result.solarGeneratedKwh)} kWh`],
        ]),
      ),
    ];

    if (result.powerShortfallKwh > 0) {
      sections.push(
        formatSection("Warnings", formatList(["Battery did not have enough energy for the full power demand."])),
      );
    }

    if (result.solarNoChargeReasons.length > 0) {
      sections.push(formatSection("Solar Notes", formatList(result.solarNoChargeReasons)));
    }

    if (constructionResult.completedModules.length > 0) {
      sections.push(
        formatSection(
          "Construction Completed",
          formatTable(
            ["Display Name", "Module ID", "Blueprint"],
            constructionResult.completedModules.map((module) => [
              module.displayName,
              getShortModuleId(module),
              module.blueprintId,
            ]),
          ),
        ),
      );
    }

    console.log(sections.join("\n\n"));
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

const program = new Command();

program
  .name("habitat")
  .description("Register this lab habitat with Kepler and inspect its registration status.")
  .version(version)
  .showHelpAfterError("(run with --help for usage)")
  .addHelpText(
    "after",
    sectionBlock("Kepler contract", [
      "register sends displayName and habitatUuid to the Kepler planet server.",
      "status fetches the latest remote registration record for this habitat.",
      "starterModules from registration hydrate local module records.",
      "unregister deletes the remote Kepler habitat registration.",
    ]),
  )
  .addHelpText(
    "after",
    exampleBlock([
      "habitat register --name \"Artemis Ridge\"",
      "habitat status",
      "habitat module list",
      "habitat tick 60",
      "habitat unregister",
    ]),
  );

const registerCommand = program
  .command("register")
  .description("Register this CLI's habitat with Kepler.")
  .requiredOption("--name <name>", "Habitat display name")
  .action(registerHabitat);

registerCommand.addHelpText(
  "after",
  exampleBlock([
    "habitat register --name \"Artemis Ridge\"",
  ]),
);

const statusCommand = program
  .command("status")
  .description("Show this habitat's Kepler registration status.")
  .action(showHabitatRegistrationStatus);

statusCommand.addHelpText(
  "after",
  exampleBlock([
    "habitat status",
  ]),
);

const unregisterCommand = program
  .command("unregister")
  .description("Unregister this habitat from Kepler.")
  .action(unregisterHabitat);

unregisterCommand.addHelpText(
  "after",
  exampleBlock([
    "habitat unregister",
  ]),
);

const constructCommand = program
  .command("construct")
  .description("Start a local construction job from an official Kepler blueprint.")
  .argument("<blueprintId>", "Blueprint ID")
  .option("--dry-run", "Preview the build without changing local state")
  .action(constructBlueprint);

constructCommand.addHelpText(
  "after",
  exampleBlock([
    "habitat construct small-solar-array --dry-run",
    "habitat construct small-solar-array",
  ]),
);

const tickCommand = program
  .command("tick")
  .description("Advance the local habitat power simulation by one-second ticks.")
  .argument("<count>", "Number of one-second ticks to run")
  .action(runTicks);

tickCommand.addHelpText(
  "after",
  exampleBlock([
    "habitat tick 1",
    "habitat tick 60",
    "habitat tick 3600",
  ]),
);

const moduleCommand = program
  .command("module")
  .description("Manage local habitat modules.");

const blueprintCommand = program
  .command("blueprint")
  .description("Read official Kepler blueprint catalog data.");

const resourceCommand = program
  .command("resource")
  .description("Read official Kepler resource catalog data.");

const solarCommand = program
  .command("solar")
  .description("Read live Kepler solar irradiance data.");

const constructionCommand = program
  .command("construction")
  .description("Inspect or cancel local construction jobs.");

const inventoryCommand = program
  .command("inventory")
  .description("Manage local habitat inventory.");

blueprintCommand.addHelpText(
  "after",
  exampleBlock([
    "habitat blueprint list",
    "habitat blueprint show small-solar-array",
  ]),
);

blueprintCommand
  .command("list")
  .description("List published Kepler blueprints.")
  .action(listBlueprints)
  .addHelpText("after", exampleBlock(["habitat blueprint list"]));

blueprintCommand
  .command("show")
  .description("Show one published Kepler blueprint.")
  .argument("<blueprintId>", "Blueprint ID")
  .action(showBlueprint)
  .addHelpText("after", exampleBlock(["habitat blueprint show small-solar-array"]));

resourceCommand.addHelpText(
  "after",
  exampleBlock([
    "habitat resource list",
  ]),
);

resourceCommand
  .command("list")
  .description("List official resource types used by Kepler.")
  .action(listResources)
  .addHelpText("after", exampleBlock(["habitat resource list"]));

solarCommand
  .command("status")
  .description("Show current Kepler solar irradiance conditions.")
  .action(showSolarStatus)
  .addHelpText("after", exampleBlock(["habitat solar status"]));

inventoryCommand.addHelpText(
  "after",
  exampleBlock([
    "habitat inventory list",
    "habitat inventory add silicate-glass 45",
  ]),
);

inventoryCommand
  .command("list")
  .description("List all local inventory resources and amounts.")
  .action(listInventory)
  .addHelpText("after", exampleBlock(["habitat inventory list"]));

inventoryCommand
  .command("add")
  .description("Add a resource amount to local inventory.")
  .argument("<resourceId>", "Resource ID")
  .argument("<amount>", "Amount to add")
  .action(addInventory)
  .addHelpText("after", exampleBlock(["habitat inventory add silicate-glass 45"]));

constructionCommand.addHelpText(
  "after",
  exampleBlock([
    "habitat construction status",
    "habitat construction cancel workshop-fabricator-1",
  ]),
);

constructionCommand
  .command("status")
  .description("Show active local construction jobs.")
  .action(showConstructionStatus)
  .addHelpText("after", exampleBlock(["habitat construction status"]));

constructionCommand
  .command("cancel")
  .description("Cancel one local construction job without refunding materials.")
  .argument("<facilityModuleId>", "Facility module ID or short ID")
  .action(cancelConstructionCommand)
  .addHelpText("after", exampleBlock(["habitat construction cancel workshop-fabricator-1"]));

moduleCommand.addHelpText(
  "after",
  exampleBlock([
    "habitat module list",
    "habitat module status",
    "habitat module set-status basic_battery_1 active",
    "habitat module show <moduleId>",
    "habitat module create --blueprint-id small-solar-array --name \"Solar Array Alpha\"",
    "habitat module update <moduleId> --status active --health 95",
    "habitat module delete <moduleId>",
  ]),
);

moduleCommand
  .command("list")
  .description("List local habitat modules.")
  .action(listModules)
  .addHelpText("after", exampleBlock(["habitat module list"]));

moduleCommand
  .command("status")
  .description("Show current module states and power draw.")
  .action(showModulePowerStatus)
  .addHelpText("after", exampleBlock(["habitat module status"]));

moduleCommand
  .command("set-status")
  .description("Change one local module runtime state.")
  .argument("<moduleId>", "Module ID or short ID")
  .argument("<status>", `Runtime status: ${moduleRuntimeStatuses.join(", ")}`)
  .action(setModuleStatus)
  .addHelpText(
    "after",
    exampleBlock([
      "habitat module set-status basic_battery_1 active",
      "habitat module set-status workshop_fabricator_1 damaged",
    ]),
  );

moduleCommand
  .command("show")
  .description("Show one local habitat module.")
  .argument("<moduleId>", "Module ID")
  .action(showModule)
  .addHelpText("after", exampleBlock(["habitat module show <moduleId>"]));

moduleCommand
  .command("create")
  .description("Create a local module from a stored Kepler blueprint.")
  .requiredOption("--blueprint-id <blueprintId>", "Blueprint ID")
  .requiredOption("--name <name>", "Module display name")
  .action(createModule)
  .addHelpText(
    "after",
    exampleBlock([
      "habitat module create --blueprint-id small-solar-array --name \"Solar Array Alpha\"",
    ]),
  );

moduleCommand
  .command("update")
  .description("Update common local module fields.")
  .argument("<moduleId>", "Module ID")
  .option("--name <name>", "Module display name")
  .option("--status <status>", "Runtime status")
  .option("--health <number>", "Runtime health")
  .action(updateModule)
  .addHelpText(
    "after",
    exampleBlock([
      "habitat module update <moduleId> --status active --health 95",
    ]),
  );

moduleCommand
  .command("delete")
  .description("Delete a local habitat module.")
  .argument("<moduleId>", "Module ID")
  .action(deleteModule)
  .addHelpText("after", exampleBlock(["habitat module delete <moduleId>"]));

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof CommanderError && error.code === "commander.unknownCommand") {
      const commandName = error.message.match(/'([^']+)'/)?.[1] ?? "that command";
      console.error(`Unknown command: ${commandName}`);
      console.error("Run `habitat --help` to see the available commands.");
      process.exit(1);
    }

    throw error;
  }
}

await main();
