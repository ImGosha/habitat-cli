#!/usr/bin/env bun

import { Command, CommanderError } from "commander";
import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import {
  findModuleById,
  formatModuleListItem,
  getShortModuleId,
  isModuleRuntimeStatus,
  moduleRuntimeStatuses,
  setModuleRuntimeStatus,
  type ModuleRecord,
} from "./modules.js";
import { applyPowerTick, formatModulePowerStatusTable, getModulePowerDrawKw } from "./power.js";

type Blueprint = {
  id?: string;
  blueprintId: string;
  displayName: string;
  description?: string;
  output?: Record<string, unknown>;
  runtimeAttributes?: Record<string, unknown>;
  capabilities?: string[];
};

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
  blueprints: Blueprint[];
};

type LocalState = {
  kepler?: HabitatRegistrationRecord;
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
  blueprints: Blueprint[];
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
dotenv.config({ path: join(projectRootPath, ".env") });
const dataFilePath = join(projectRootPath, "habitat.json");

function exampleBlock(lines: string[]): string {
  return `\nExamples:\n${lines.map((line) => `  ${line}`).join("\n")}\n`;
}

function sectionBlock(title: string, lines: string[]): string {
  return `\n${title}:\n${lines.map((line) => `  ${line}`).join("\n")}\n`;
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

function printRegistrationStatus(registration: HabitatRegistrationRecord): void {
  console.log(`Display Name: ${registration.displayName}`);
  console.log(`Habitat UUID: ${registration.habitatUuid}`);
  console.log(`Habitat ID: ${registration.habitatId}`);
  console.log(`Base URL: ${registration.baseUrl}`);
  console.log(`Habitat Slug: ${registration.habitatSlug ?? "Unknown"}`);
  console.log(`Status: ${registration.status ?? "Unknown"}`);
  console.log(`Catalog Version: ${registration.catalogVersion ?? "Unknown"}`);
  console.log(`Last Seen At: ${registration.lastSeenAt ?? "Unknown"}`);
  console.log(`Starter Modules: ${registration.starterModules.length}`);
  console.log(`Blueprints: ${registration.blueprints.length}`);
}

function printModule(module: ModuleRecord): void {
  console.log(`ID: ${module.id}`);
  console.log(`Short ID: ${getShortModuleId(module)}`);
  console.log(`Display Name: ${module.displayName}`);
  console.log(`Blueprint ID: ${module.blueprintId}`);
  console.log(`Status: ${module.runtimeAttributes.status ?? "Unknown"}`);
  console.log(`Health: ${module.runtimeAttributes.health ?? "Unknown"}`);
  console.log(`Connected To: ${module.connectedTo.length > 0 ? module.connectedTo.join(", ") : "None"}`);
  console.log(`Capabilities: ${module.capabilities.length > 0 ? module.capabilities.join(", ") : "None"}`);
  console.log(`Runtime Attributes: ${JSON.stringify(module.runtimeAttributes, null, 2)}`);
}

function findBlueprint(state: LocalState, blueprintId: string): Blueprint | undefined {
  return state.kepler?.blueprints.find((blueprint) => blueprint.blueprintId === blueprintId);
}

function createLocalModuleId(blueprintId: string): string {
  return `local_${blueprintId.replace(/[^a-zA-Z0-9]+/g, "_")}_${randomUUID()}`;
}

function formatEnergy(value: number): string {
  return Number(value.toFixed(6)).toString();
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
  state.modules = registration.starterModules.map(cloneModule);

  await writeState(state);
  console.log(`Registered habitat "${requestBody.displayName}" with Kepler.`);
  console.log(`Habitat ID: ${registration.habitatId}`);
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
  printRegistrationStatus(state.kepler);
  console.log(`Modules: ${state.modules?.length ?? 0}`);
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

  console.log(`Unregistered habitat "${deletedDisplayName}" from Kepler.`);
}

async function listModules(): Promise<void> {
  const state = await readAndPersistState();
  const modules = state.modules ?? [];

  if (modules.length === 0) {
    console.log("No modules found.");
    return;
  }

  for (const module of modules) {
    console.log(formatModuleListItem(module));
  }
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

  printModule(module);
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
    `Updated ${getShortModuleId(module)} to ${status}. Current power draw: ${formatEnergy(getModulePowerDrawKw(module))} kW.`,
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
    id: createLocalModuleId(options.blueprintId),
    blueprintId: blueprint.blueprintId,
    displayName: options.name,
    connectedTo: [],
    runtimeAttributes: { ...(blueprint.runtimeAttributes ?? {}) },
    capabilities: [...(blueprint.capabilities ?? [])],
  };

  state.modules = [...(state.modules ?? []), module];
  await writeState(state);

  console.log(`Created module "${module.displayName}".`);
  console.log(`Module ID: ${getShortModuleId(module)}`);
  console.log(`Full ID: ${module.id}`);
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
  console.log(`Updated module "${getShortModuleId(module)}".`);
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
  console.log(`Deleted module "${getShortModuleId(module)}".`);
}

async function runTicks(count: string): Promise<void> {
  const tickCount = parseTickCount(count);
  const state = await readAndPersistState();

  try {
    const result = applyPowerTick(state, tickCount);
    await writeState(state);

    const battery = findModuleById(state.modules, result.batteryId);
    const batteryLabel = battery ? getShortModuleId(battery) : result.batteryId;

    console.log(`Advanced ${result.tickCount} tick(s).`);
    console.log(`Current Tick: ${result.currentTick}`);
    console.log(`Power Draw: ${formatEnergy(result.totalPowerDrawKw)} kW`);
    console.log(`Energy Requested: ${formatEnergy(result.energyRequestedKwh)} kWh`);
    console.log(`Energy Drained: ${formatEnergy(result.energyDrainedKwh)} kWh`);

    if (result.powerShortfallKwh > 0) {
      console.log(`Power Shortfall: ${formatEnergy(result.powerShortfallKwh)} kWh`);
    }

    console.log(`Battery: ${batteryLabel}`);
    console.log(`Battery Remaining: ${formatEnergy(result.batteryEnergyRemainingKwh)} kWh`);

    if (result.powerShortfallKwh > 0) {
      console.log("Warning: battery did not have enough energy for the full power demand.");
    }
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
