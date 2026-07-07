#!/usr/bin/env bun

import { Command, CommanderError } from "commander";
import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

type StarterModule = {
  id: string;
  blueprintId: string;
  displayName: string;
  connectedTo: string[];
  runtimeAttributes: Record<string, unknown>;
  capabilities: string[];
};

type Blueprint = {
  id?: string;
  blueprintId: string;
  displayName: string;
  description?: string;
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
  starterModules: StarterModule[];
  blueprints: Blueprint[];
};

type LocalState = {
  kepler?: HabitatRegistrationRecord;
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
  starterModules: StarterModule[];
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
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }

    throw error;
  }
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

  await writeState(state);
  console.log(`Registered habitat "${requestBody.displayName}" with Kepler.`);
  console.log(`Habitat ID: ${registration.habitatId}`);
}

async function showHabitatRegistrationStatus(): Promise<void> {
  const state = await readState();

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
      "unregister deletes the remote Kepler habitat registration.",
    ]),
  )
  .addHelpText(
    "after",
    exampleBlock([
      "habitat register --name \"Artemis Ridge\"",
      "habitat status",
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
