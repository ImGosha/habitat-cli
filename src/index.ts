#!/usr/bin/env bun

import { Command, CommanderError } from "commander";
import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { formatBlueprintDetails, formatBlueprintList, type BlueprintRecord } from "./blueprints.js";
import {
  advanceConstructionJobs,
  cancelConstruction,
  formatConstructionStatus,
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
import { HabitatApiClient } from "./habitat-api-client.js";
import { formatInventoryList } from "./inventory.js";
import { type HabitatRegistrationRecord, type LocalState } from "./local-state.js";
import { formatResourceList } from "./resources.js";
import { formatScanReport, validateScanOptions, type ScanOptions } from "./scan.js";
import { formatSolarStatus } from "./solar.js";
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

type RegisterOptions = {
  name: string;
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

type ScanCommandOptions = {
  x: string;
  y: string;
  strength: string;
  radius?: string;
  json?: boolean;
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
const habitatApiClient = new HabitatApiClient();

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

async function readState(): Promise<LocalState> {
  const response = await habitatApiClient.getLocalState();
  return response.state;
}

async function readAndPersistState(): Promise<LocalState> {
  return readState();
}

async function writeState(state: LocalState): Promise<void> {
  await habitatApiClient.saveLocalState(state);
}

async function deleteDataFileIfEmpty(state: LocalState): Promise<void> {
  await habitatApiClient.saveLocalState(state);
}

function formatRegistrationStatus(
  registration: Pick<
    HabitatRegistrationRecord,
    "displayName" | "habitatUuid" | "habitatId" | "baseUrl" | "habitatSlug" | "status" | "catalogVersion" | "lastSeenAt"
  > & {
    starterModuleCount: number;
    blueprintCount: number;
    localModuleCount: number;
  },
): string {
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
      ["Starter Modules", String(registration.starterModuleCount)],
      ["Blueprints", String(registration.blueprintCount)],
      ["Local Modules", String(registration.localModuleCount)],
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
  try {
    const response = await habitatApiClient.registerHabitat(options.name);
    console.log(
      formatResultSummary("Registration Complete", [
        ["Display Name", response.registration.displayName],
        ["Habitat ID", response.registration.habitatId],
        ["Starter Modules", String(response.registration.starterModules)],
        ["Blueprints", String(response.registration.blueprints)],
      ]),
    );
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

async function showHabitatRegistrationStatus(): Promise<void> {
  try {
    const response = await habitatApiClient.getStatus();
    const registration = {
      displayName: response.registration.displayName,
      habitatUuid: response.registration.habitatUuid,
      habitatId: response.registration.habitatId,
      baseUrl: response.registration.baseUrl,
      habitatSlug: response.registration.habitatSlug,
      status: response.registration.status,
      catalogVersion: response.registration.catalogVersion,
      lastSeenAt: response.registration.lastSeenAt,
      starterModuleCount: response.registration.starterModules,
      blueprintCount: response.registration.blueprints,
      localModuleCount: response.registration.localModules,
    };
    console.log(formatRegistrationStatus(registration));
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

async function unregisterHabitat(): Promise<void> {
  try {
    const response = await habitatApiClient.unregisterHabitat();
    console.log(
      formatResultSummary("Unregistration Complete", [
        ["Display Name", response.registration.displayName],
        ["Status", response.registration.status],
      ]),
    );
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

async function listBlueprints(): Promise<void> {
  try {
    const response = await habitatApiClient.listBlueprints();

    console.log(formatBlueprintList(response.blueprints));
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

async function showBlueprint(blueprintId: string): Promise<void> {
  try {
    const response = await habitatApiClient.showBlueprint(blueprintId);

    console.log(formatBlueprintDetails(response.blueprint));
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

async function listResources(): Promise<void> {
  try {
    const response = await habitatApiClient.listResources();

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
        formatResourceList(response.resources),
      ].join("\n\n"),
    );
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

async function showSolarStatus(): Promise<void> {
  try {
    const response = await habitatApiClient.getSolarIrradiance();

    console.log(formatSolarStatus(response.solarIrradiance));
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

async function scanResources(options: ScanCommandOptions): Promise<void> {
  const parsedOptions: ScanOptions = {
    x: Number(options.x),
    y: Number(options.y),
    strength: Number(options.strength),
    radius: options.radius === undefined ? 0 : Number(options.radius),
    json: options.json,
  };

  const validationMessage = validateScanOptions(parsedOptions);
  if (validationMessage) {
    console.error(validationMessage);
    process.exit(1);
  }

  try {
    const response = await habitatApiClient.scan({
      x: parsedOptions.x,
      y: parsedOptions.y,
      strength: parsedOptions.strength,
      radius: parsedOptions.radius,
    });

    if (parsedOptions.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    console.log(formatScanReport(response));
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

async function constructBlueprint(blueprintId: string, options: ConstructOptions): Promise<void> {
  try {
    const state = await readState();
    const blueprint = (await habitatApiClient.showBlueprint(blueprintId)).blueprint;
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
  try {
    const state = await readState();
    console.log(formatConstructionStatus(state.modules ?? []));
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

async function cancelConstructionCommand(facilityModuleId: string): Promise<void> {
  try {
    const state = await readState();
    const facility = findModuleById(state.modules, facilityModuleId);

    if (!facility) {
      console.error(`Module "${facilityModuleId}" was not found.`);
      process.exit(1);
    }

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
  try {
    const response = await habitatApiClient.listInventory();
    console.log(formatInventoryList(response.inventory));
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

async function addInventory(resourceId: string, amount: string): Promise<void> {
  const numericAmount = Number(amount);

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    console.error("amount must be a positive number.");
    process.exit(1);
  }

  try {
    const result = await habitatApiClient.changeInventory(resourceId, numericAmount);
    console.log(
      formatResultSummary("Inventory Updated", [
        ["Resource", resourceId],
        ["Added", formatEnergy(numericAmount)],
        ["Previous Amount", formatEnergy(result.previousAmount)],
        ["New Amount", formatEnergy(result.newAmount)],
      ]),
    );
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

async function removeInventory(resourceId: string, amount: string): Promise<void> {
  const numericAmount = Number(amount);

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    console.error("amount must be a positive number.");
    process.exit(1);
  }

  try {
    const result = await habitatApiClient.changeInventory(resourceId, -numericAmount);
    console.log(
      formatResultSummary("Inventory Updated", [
        ["Resource", resourceId],
        ["Removed", formatEnergy(numericAmount)],
        ["Previous Amount", formatEnergy(result.previousAmount)],
        ["New Amount", formatEnergy(result.newAmount)],
      ]),
    );
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

async function listModules(): Promise<void> {
  try {
    const response = await habitatApiClient.listModules();
    console.log(formatModuleList(response.modules));
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

async function showModulePowerStatus(): Promise<void> {
  try {
    const response = await habitatApiClient.listModules();
    console.log(formatModulePowerStatusTable(response.modules));
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

async function showModule(moduleId: string): Promise<void> {
  try {
    const response = await habitatApiClient.showModule(moduleId);
    console.log(formatModuleDetails(response.module));
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

async function setModuleStatus(moduleId: string, status: string): Promise<void> {
  if (!isModuleRuntimeStatus(status)) {
    console.error(`Status must be one of: ${moduleRuntimeStatuses.join(", ")}.`);
    process.exit(1);
  }

  try {
    const response = await habitatApiClient.updateModule(moduleId, { status });
    const module = response.module;
    console.log(
      formatResultSummary("Module Status Updated", [
        ["Module ID", getShortModuleId(module)],
        ["Status", status],
        ["Current Power Draw", `${formatEnergy(getModulePowerDrawKw(module))} kW`],
      ]),
    );
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

async function createModule(options: ModuleCreateOptions): Promise<void> {
  try {
    const response = await habitatApiClient.createModule(options.blueprintId, options.name);
    const module = response.module;
    console.log(
      formatResultSummary("Module Created", [
        ["Display Name", module.displayName],
        ["Module ID", getShortModuleId(module)],
        ["Full ID", module.id],
        ["Blueprint", module.blueprintId],
      ]),
    );
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

async function updateModule(moduleId: string, options: ModuleUpdateOptions): Promise<void> {
  const updates: { name?: string; status?: string; health?: number } = {};

  if (options.name !== undefined) {
    updates.name = options.name;
  }

  if (options.status !== undefined) {
    updates.status = options.status;
  }

  if (options.health !== undefined) {
    const health = Number(options.health);

    if (Number.isNaN(health)) {
      console.error("health must be a number.");
      process.exit(1);
    }

    updates.health = health;
  }

  try {
    const response = await habitatApiClient.updateModule(moduleId, updates);
    const module = response.module;
    console.log(
      formatResultSummary("Module Updated", [
        ["Module ID", getShortModuleId(module)],
        ["Display Name", module.displayName],
        ["Status", String(module.runtimeAttributes.status ?? "Unknown")],
        ["Health", String(module.runtimeAttributes.health ?? "Unknown")],
      ]),
    );
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

async function deleteModule(moduleId: string): Promise<void> {
  try {
    const response = await habitatApiClient.deleteModule(moduleId);
    const module = response.module;
    console.log(
      formatResultSummary("Module Deleted", [
        ["Module ID", getShortModuleId(module)],
        ["Display Name", module.displayName],
      ]),
    );
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

async function runTicks(count: string): Promise<void> {
  const tickCount = parseTickCount(count);

  try {
    const state = await readAndPersistState();
    const result = await runPowerSimulation(state, tickCount, () =>
      habitatApiClient.getSolarIrradiance().then((response) => response.solarIrradiance),
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

const powerCommand = program
  .command("power")
  .description("Inspect habitat power state.");

const blueprintCommand = program
  .command("blueprint")
  .description("Read official Kepler blueprint catalog data.");

const resourceCommand = program
  .command("resource")
  .description("Read official Kepler resource catalog data.");

const solarCommand = program
  .command("solar")
  .description("Read live Kepler solar irradiance data.");

const scanCommand = program
  .command("scan")
  .description("Scan nearby Kepler tiles for resource probabilities.")
  .requiredOption("--x <integer>", "Current x coordinate")
  .requiredOption("--y <integer>", "Current y coordinate")
  .requiredOption("--strength <0-100>", "Effective sensor strength")
  .option("--radius <0-5>", "Scan radius in tiles", "0")
  .option("--json", "Print the raw JSON scan response")
  .action(scanResources);

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

scanCommand.addHelpText(
  "after",
  exampleBlock([
    "habitat scan --x 3 --y -2 --strength 60",
    "habitat scan --x 3 --y -2 --strength 60 --radius 1",
    "habitat scan --x 3 --y -2 --strength 60 --radius 1 --json",
  ]),
);

powerCommand
  .command("overview")
  .description("Show current module states and power draw.")
  .action(showModulePowerStatus)
  .addHelpText("after", exampleBlock(["habitat power overview"]));

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

inventoryCommand
  .command("remove")
  .description("Remove a resource amount from local inventory.")
  .argument("<resourceId>", "Resource ID")
  .argument("<amount>", "Amount to remove")
  .action(removeInventory)
  .addHelpText("after", exampleBlock(["habitat inventory remove silicate-glass 45"]));

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
