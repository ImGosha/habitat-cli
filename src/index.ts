#!/usr/bin/env bun

import { Command, CommanderError } from "commander";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

type BatteryBank = {
  name: string;
  chargeLevel: number;
  capacity: number;
  efficiency: number;
  health: number;
  connectedPanels: string[];
};

type SolarPanel = {
  name: string;
  efficiency: number;
  panelOn: boolean;
};

type Rover = {
  name: string;
  health: number;
  speed: number;
  location: string;
};

type HabitatData = {
  batteryBanks: BatteryBank[];
  solarPanels: SolarPanel[];
  rovers: Rover[];
};

type BatteryOptions = {
  name: string;
  chargeLevel?: string;
  capacity?: string;
  efficiency?: string;
  health?: string;
};

type PanelOptions = {
  name: string;
  efficiency?: string;
  panelOn?: string;
};

type RoverOptions = {
  name: string;
  health?: string;
  speed?: string;
  location?: string;
};

const version = "0.1.0";
const dataFilePath = join(homedir(), ".habitat", "battery-banks.json");

function parseNumber(value: string, label: string): number {
  const parsed = Number(value);

  if (Number.isNaN(parsed)) {
    throw new Error(`${label} must be a number.`);
  }

  return parsed;
}

function parseBoolean(value: string, label: string): boolean {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`${label} must be true or false.`);
}

function exampleBlock(lines: string[]): string {
  return `\nExamples:\n${lines.map((line) => `  ${line}`).join("\n")}\n`;
}

async function ensureDataDir(): Promise<void> {
  await mkdir(dirname(dataFilePath), { recursive: true });
}

async function readData(): Promise<HabitatData> {
  try {
    const raw = await readFile(dataFilePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<HabitatData>;
    const batteryBanks = Array.isArray(parsed.batteryBanks)
      ? parsed.batteryBanks.map((batteryBank) => ({
          ...batteryBank,
          connectedPanels: Array.isArray(batteryBank.connectedPanels)
            ? batteryBank.connectedPanels
            : [],
        }))
      : [];

    return {
      batteryBanks,
      solarPanels: Array.isArray(parsed.solarPanels) ? parsed.solarPanels : [],
      rovers: Array.isArray(parsed.rovers) ? parsed.rovers : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { batteryBanks: [], solarPanels: [], rovers: [] };
    }

    throw error;
  }
}

async function writeData(data: HabitatData): Promise<void> {
  await ensureDataDir();
  await writeFile(dataFilePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function deleteDataFileIfEmpty(data: HabitatData): Promise<void> {
  if (data.batteryBanks.length > 0 || data.solarPanels.length > 0 || data.rovers.length > 0) {
    await writeData(data);
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

function findBatteryBank(data: HabitatData, name: string): BatteryBank | undefined {
  return data.batteryBanks.find((batteryBank) => batteryBank.name === name);
}

function findSolarPanel(data: HabitatData, name: string): SolarPanel | undefined {
  return data.solarPanels.find((solarPanel) => solarPanel.name === name);
}

function findRover(data: HabitatData, name: string): Rover | undefined {
  return data.rovers.find((rover) => rover.name === name);
}

function printBatteryBank(batteryBank: BatteryBank): void {
  console.log(`Name: ${batteryBank.name}`);
  console.log(`Charge Level: ${batteryBank.chargeLevel}`);
  console.log(`Capacity: ${batteryBank.capacity}`);
  console.log(`Efficiency: ${batteryBank.efficiency}`);
  console.log(`Health: ${batteryBank.health}`);
  console.log(
    `Connected Solar Panels: ${
      batteryBank.connectedPanels.length > 0
        ? batteryBank.connectedPanels.join(", ")
        : "None"
    }`,
  );
}

function printSolarPanel(solarPanel: SolarPanel): void {
  console.log(`Name: ${solarPanel.name}`);
  console.log(`Efficiency: ${solarPanel.efficiency}`);
  console.log(`Panel On: ${solarPanel.panelOn}`);
}

function printRover(rover: Rover): void {
  console.log(`Name: ${rover.name}`);
  console.log(`Health: ${rover.health}`);
  console.log(`Speed: ${rover.speed}`);
  console.log(`Location: ${rover.location}`);
}

async function createBattery(options: BatteryOptions): Promise<void> {
  const data = await readData();

  if (findBatteryBank(data, options.name)) {
    console.error(`Battery bank "${options.name}" already exists.`);
    process.exit(1);
  }

  const batteryBank: BatteryBank = {
    name: options.name,
    chargeLevel: parseNumber(options.chargeLevel!, "chargeLevel"),
    capacity: parseNumber(options.capacity!, "capacity"),
    efficiency: parseNumber(options.efficiency!, "efficiency"),
    health: parseNumber(options.health!, "health"),
    connectedPanels: [],
  };

  data.batteryBanks.push(batteryBank);
  await writeData(data);

  console.log(`Created battery bank "${batteryBank.name}".`);
}

async function listBatteries(): Promise<void> {
  const data = await readData();

  if (data.batteryBanks.length === 0) {
    console.log("No battery banks found.");
    return;
  }

  for (const batteryBank of data.batteryBanks) {
    console.log(
      `${batteryBank.name}: chargeLevel=${batteryBank.chargeLevel}, capacity=${batteryBank.capacity}, efficiency=${batteryBank.efficiency}, health=${batteryBank.health}`,
    );
  }
}

async function statusBattery(name: string): Promise<void> {
  const data = await readData();
  const batteryBank = findBatteryBank(data, name);

  if (!batteryBank) {
    console.error(`Battery bank "${name}" was not found.`);
    process.exit(1);
  }

  printBatteryBank(batteryBank);
}

async function updateBattery(name: string, options: Partial<BatteryOptions>): Promise<void> {
  const data = await readData();
  const batteryBank = findBatteryBank(data, name);

  if (!batteryBank) {
    console.error(`Battery bank "${name}" was not found.`);
    process.exit(1);
  }

  if (options.name && options.name !== name && findBatteryBank(data, options.name)) {
    console.error(`Battery bank "${options.name}" already exists.`);
    process.exit(1);
  }

  if (options.name) {
    batteryBank.name = options.name;
  }

  if (options.chargeLevel !== undefined) {
    batteryBank.chargeLevel = parseNumber(options.chargeLevel, "chargeLevel");
  }

  if (options.capacity !== undefined) {
    batteryBank.capacity = parseNumber(options.capacity, "capacity");
  }

  if (options.efficiency !== undefined) {
    batteryBank.efficiency = parseNumber(options.efficiency, "efficiency");
  }

  if (options.health !== undefined) {
    batteryBank.health = parseNumber(options.health, "health");
  }

  await writeData(data);
  console.log(`Updated battery bank "${batteryBank.name}".`);
}

async function deleteBattery(name: string): Promise<void> {
  const data = await readData();
  const batteryBank = findBatteryBank(data, name);

  if (!batteryBank) {
    console.error(`Battery bank "${name}" was not found.`);
    process.exit(1);
  }

  data.batteryBanks = data.batteryBanks.filter((entry) => entry.name !== name);
  await deleteDataFileIfEmpty(data);

  console.log(`Deleted battery bank "${name}".`);
}

async function connectPanelToBattery(batteryName: string, panelName: string): Promise<void> {
  const data = await readData();
  const batteryBank = findBatteryBank(data, batteryName);
  const solarPanel = findSolarPanel(data, panelName);

  if (!batteryBank) {
    console.error(`Battery bank "${batteryName}" was not found.`);
    process.exit(1);
  }

  if (!solarPanel) {
    console.error(`Solar panel "${panelName}" was not found.`);
    process.exit(1);
  }

  if (batteryBank.connectedPanels.includes(panelName)) {
    console.error(`Solar panel "${panelName}" is already connected to battery bank "${batteryName}".`);
    process.exit(1);
  }

  batteryBank.connectedPanels.push(panelName);
  await writeData(data);

  console.log(`Connected solar panel "${panelName}" to battery bank "${batteryName}".`);
}

async function createPanel(options: PanelOptions): Promise<void> {
  const data = await readData();

  if (findSolarPanel(data, options.name)) {
    console.error(`Solar panel "${options.name}" already exists.`);
    process.exit(1);
  }

  const solarPanel: SolarPanel = {
    name: options.name,
    efficiency: parseNumber(options.efficiency!, "efficiency"),
    panelOn: parseBoolean(options.panelOn!, "panelOn"),
  };

  data.solarPanels.push(solarPanel);
  await writeData(data);

  console.log(`Created solar panel "${solarPanel.name}".`);
}

async function listPanels(): Promise<void> {
  const data = await readData();

  if (data.solarPanels.length === 0) {
    console.log("No solar panels found.");
    return;
  }

  for (const solarPanel of data.solarPanels) {
    console.log(`${solarPanel.name}: efficiency=${solarPanel.efficiency}, panelOn=${solarPanel.panelOn}`);
  }
}

async function statusPanel(name: string): Promise<void> {
  const data = await readData();
  const solarPanel = findSolarPanel(data, name);

  if (!solarPanel) {
    console.error(`Solar panel "${name}" was not found.`);
    process.exit(1);
  }

  printSolarPanel(solarPanel);
}

async function updatePanel(name: string, options: Partial<PanelOptions>): Promise<void> {
  const data = await readData();
  const solarPanel = findSolarPanel(data, name);

  if (!solarPanel) {
    console.error(`Solar panel "${name}" was not found.`);
    process.exit(1);
  }

  if (options.name && options.name !== name && findSolarPanel(data, options.name)) {
    console.error(`Solar panel "${options.name}" already exists.`);
    process.exit(1);
  }

  if (options.name) {
    solarPanel.name = options.name;

    for (const batteryBank of data.batteryBanks) {
      batteryBank.connectedPanels = batteryBank.connectedPanels.map((panelName) =>
        panelName === name ? options.name! : panelName,
      );
    }
  }

  if (options.efficiency !== undefined) {
    solarPanel.efficiency = parseNumber(options.efficiency, "efficiency");
  }

  if (options.panelOn !== undefined) {
    solarPanel.panelOn = parseBoolean(options.panelOn, "panelOn");
  }

  await writeData(data);
  console.log(`Updated solar panel "${solarPanel.name}".`);
}

async function deletePanel(name: string): Promise<void> {
  const data = await readData();
  const solarPanel = findSolarPanel(data, name);

  if (!solarPanel) {
    console.error(`Solar panel "${name}" was not found.`);
    process.exit(1);
  }

  data.solarPanels = data.solarPanels.filter((entry) => entry.name !== name);

  for (const batteryBank of data.batteryBanks) {
    batteryBank.connectedPanels = batteryBank.connectedPanels.filter((panelName) => panelName !== name);
  }

  await deleteDataFileIfEmpty(data);
  console.log(`Deleted solar panel "${name}".`);
}

async function createRover(options: RoverOptions): Promise<void> {
  const data = await readData();

  if (findRover(data, options.name)) {
    console.error(`Rover "${options.name}" already exists.`);
    process.exit(1);
  }

  const rover: Rover = {
    name: options.name,
    health: parseNumber(options.health!, "health"),
    speed: parseNumber(options.speed!, "speed"),
    location: options.location!,
  };

  data.rovers.push(rover);
  await writeData(data);

  console.log(`Created rover "${rover.name}".`);
}

async function listRovers(): Promise<void> {
  const data = await readData();

  if (data.rovers.length === 0) {
    console.log("No rovers found.");
    return;
  }

  for (const rover of data.rovers) {
    console.log(`${rover.name}: health=${rover.health}, speed=${rover.speed}, location=${rover.location}`);
  }
}

async function statusRover(name: string): Promise<void> {
  const data = await readData();
  const rover = findRover(data, name);

  if (!rover) {
    console.error(`Rover "${name}" was not found.`);
    process.exit(1);
  }

  printRover(rover);
}

async function updateRover(name: string, options: Partial<RoverOptions>): Promise<void> {
  const data = await readData();
  const rover = findRover(data, name);

  if (!rover) {
    console.error(`Rover "${name}" was not found.`);
    process.exit(1);
  }

  if (options.name && options.name !== name && findRover(data, options.name)) {
    console.error(`Rover "${options.name}" already exists.`);
    process.exit(1);
  }

  if (options.name) {
    rover.name = options.name;
  }

  if (options.health !== undefined) {
    rover.health = parseNumber(options.health, "health");
  }

  if (options.speed !== undefined) {
    rover.speed = parseNumber(options.speed, "speed");
  }

  if (options.location !== undefined) {
    rover.location = options.location;
  }

  await writeData(data);
  console.log(`Updated rover "${rover.name}".`);
}

async function deleteRover(name: string): Promise<void> {
  const data = await readData();
  const rover = findRover(data, name);

  if (!rover) {
    console.error(`Rover "${name}" was not found.`);
    process.exit(1);
  }

  data.rovers = data.rovers.filter((entry) => entry.name !== name);
  await deleteDataFileIfEmpty(data);

  console.log(`Deleted rover "${name}".`);
}

const program = new Command();

program
  .name("habitat")
  .description("Manage habitat batteries, solar panels, and rovers.")
  .version(version)
  .showHelpAfterError("(run with --help for usage)")
  .addHelpText(
    "after",
    exampleBlock([
      "habitat create battery --name main --charge-level 80 --capacity 1000 --efficiency 0.92 --health 0.98",
      "habitat create panel --name roof-east --efficiency 0.87 --panel-on true",
      "habitat battery connect-panel main roof-east",
      "habitat create rover --name scout --health 95 --speed 12 --location bay-a",
      "habitat battery --help",
      "habitat panel --help",
      "habitat rover --help",
    ]),
  );

const createCommand = program.command("create").description("Create habitat objects.");
const listCommand = program.command("list").description("List habitat objects.");
const statusCommand = program.command("status").description("Show object status.");
const updateCommand = program.command("update").description("Update habitat objects.");
const deleteCommand = program.command("delete").description("Delete habitat objects.");
const batteryCommand = program.command("battery").description("Manage battery banks and panel connections.");
const panelCommand = program.command("panel").description("Manage solar panels.");
const roverCommand = program.command("rover").description("Manage rovers.");

createCommand.addHelpText(
  "after",
  exampleBlock([
    "habitat create battery --name main --charge-level 80 --capacity 1000 --efficiency 0.92 --health 0.98",
    "habitat create panel --name roof-east --efficiency 0.87 --panel-on true",
    "habitat create rover --name scout --health 95 --speed 12 --location bay-a",
  ]),
);

listCommand.addHelpText(
  "after",
  exampleBlock([
    "habitat list batteries",
    "habitat list panels",
    "habitat list rovers",
  ]),
);

statusCommand.addHelpText(
  "after",
  exampleBlock([
    "habitat status battery main",
    "habitat status panel roof-east",
    "habitat status rover scout",
  ]),
);

updateCommand.addHelpText(
  "after",
  exampleBlock([
    "habitat update battery main --health 0.95",
    "habitat update panel roof-east --panel-on false",
    "habitat update rover scout --location ridge-2",
  ]),
);

deleteCommand.addHelpText(
  "after",
  exampleBlock([
    "habitat delete battery main",
    "habitat delete panel roof-east",
    "habitat delete rover scout",
  ]),
);

const createBatteryCommand = createCommand
  .command("battery")
  .description("Create a battery bank.")
  .requiredOption("--name <name>", "Battery bank name")
  .requiredOption("--charge-level <number>", "Current charge level")
  .requiredOption("--capacity <number>", "Battery capacity")
  .requiredOption("--efficiency <number>", "Battery efficiency")
  .requiredOption("--health <number>", "Battery health")
  .action(createBattery);

createBatteryCommand.addHelpText(
  "after",
  exampleBlock([
    "habitat create battery --name main --charge-level 80 --capacity 1000 --efficiency 0.92 --health 0.98",
  ]),
);

const createPanelCommand = createCommand
  .command("panel")
  .description("Create a solar panel.")
  .requiredOption("--name <name>", "Solar panel name")
  .requiredOption("--efficiency <number>", "Panel efficiency")
  .requiredOption("--panel-on <true|false>", "Whether the panel is on")
  .action(createPanel);

createPanelCommand.addHelpText(
  "after",
  exampleBlock([
    "habitat create panel --name roof-east --efficiency 0.87 --panel-on true",
  ]),
);

const createRoverCommand = createCommand
  .command("rover")
  .description("Create a rover.")
  .requiredOption("--name <name>", "Rover name")
  .requiredOption("--health <number>", "Rover health")
  .requiredOption("--speed <number>", "Rover speed")
  .requiredOption("--location <location>", "Rover location")
  .action(createRover);

createRoverCommand.addHelpText(
  "after",
  exampleBlock([
    "habitat create rover --name scout --health 95 --speed 12 --location bay-a",
  ]),
);

const listBatteriesCommand = listCommand
  .command("batteries")
  .description("List all battery banks.")
  .action(listBatteries);

listBatteriesCommand.addHelpText("after", exampleBlock(["habitat list batteries"]));

const listPanelsCommand = listCommand
  .command("panels")
  .description("List all solar panels.")
  .action(listPanels);

listPanelsCommand.addHelpText("after", exampleBlock(["habitat list panels"]));

const listRoversCommand = listCommand
  .command("rovers")
  .description("List all rovers.")
  .action(listRovers);

listRoversCommand.addHelpText("after", exampleBlock(["habitat list rovers"]));

const statusBatteryCommand = statusCommand
  .command("battery")
  .description("Show a battery bank.")
  .argument("<name>", "Battery bank name")
  .action(statusBattery);

statusBatteryCommand.addHelpText("after", exampleBlock(["habitat status battery main"]));

const statusPanelCommand = statusCommand
  .command("panel")
  .description("Show a solar panel.")
  .argument("<name>", "Solar panel name")
  .action(statusPanel);

statusPanelCommand.addHelpText("after", exampleBlock(["habitat status panel roof-east"]));

const statusRoverCommand = statusCommand
  .command("rover")
  .description("Show a rover.")
  .argument("<name>", "Rover name")
  .action(statusRover);

statusRoverCommand.addHelpText("after", exampleBlock(["habitat status rover scout"]));

const updateBatteryCommand = updateCommand
  .command("battery")
  .description("Update a battery bank.")
  .argument("<name>", "Battery bank name")
  .option("--name <newName>", "New battery bank name")
  .option("--charge-level <number>", "Updated charge level")
  .option("--capacity <number>", "Updated capacity")
  .option("--efficiency <number>", "Updated efficiency")
  .option("--health <number>", "Updated health")
  .action(updateBattery);

updateBatteryCommand.addHelpText(
  "after",
  exampleBlock([
    "habitat update battery main --health 0.95",
    "habitat update battery main --name house",
  ]),
);

const updatePanelCommand = updateCommand
  .command("panel")
  .description("Update a solar panel.")
  .argument("<name>", "Solar panel name")
  .option("--name <newName>", "New solar panel name")
  .option("--efficiency <number>", "Updated efficiency")
  .option("--panel-on <true|false>", "Updated panel state")
  .action(updatePanel);

updatePanelCommand.addHelpText(
  "after",
  exampleBlock([
    "habitat update panel roof-east --panel-on false",
    "habitat update panel roof-east --name roof-west",
  ]),
);

const updateRoverCommand = updateCommand
  .command("rover")
  .description("Update a rover.")
  .argument("<name>", "Rover name")
  .option("--name <newName>", "New rover name")
  .option("--health <number>", "Updated health")
  .option("--speed <number>", "Updated speed")
  .option("--location <location>", "Updated location")
  .action(updateRover);

updateRoverCommand.addHelpText(
  "after",
  exampleBlock([
    "habitat update rover scout --location ridge-2",
    "habitat update rover scout --name pathfinder",
  ]),
);

const deleteBatteryCommand = deleteCommand
  .command("battery")
  .description("Delete a battery bank.")
  .argument("<name>", "Battery bank name")
  .action(deleteBattery);

deleteBatteryCommand.addHelpText("after", exampleBlock(["habitat delete battery main"]));

const deletePanelCommand = deleteCommand
  .command("panel")
  .description("Delete a solar panel.")
  .argument("<name>", "Solar panel name")
  .action(deletePanel);

deletePanelCommand.addHelpText("after", exampleBlock(["habitat delete panel roof-east"]));

const deleteRoverCommand = deleteCommand
  .command("rover")
  .description("Delete a rover.")
  .argument("<name>", "Rover name")
  .action(deleteRover);

deleteRoverCommand.addHelpText("after", exampleBlock(["habitat delete rover scout"]));

batteryCommand.addHelpText(
  "after",
  exampleBlock([
    "habitat battery create --name main --charge-level 80 --capacity 1000 --efficiency 0.92 --health 0.98",
    "habitat battery list",
    "habitat battery status main",
    "habitat battery update main --health 0.95",
    "habitat battery connect-panel main roof-east",
    "habitat battery delete main",
  ]),
);

panelCommand.addHelpText(
  "after",
  exampleBlock([
    "habitat panel create --name roof-east --efficiency 0.87 --panel-on true",
    "habitat panel list",
    "habitat panel status roof-east",
    "habitat panel update roof-east --panel-on false",
    "habitat panel delete roof-east",
  ]),
);

roverCommand.addHelpText(
  "after",
  exampleBlock([
    "habitat rover create --name scout --health 95 --speed 12 --location bay-a",
    "habitat rover list",
    "habitat rover status scout",
    "habitat rover update scout --location ridge-2",
    "habitat rover delete scout",
  ]),
);

batteryCommand
  .command("create")
  .description("Create a battery bank.")
  .requiredOption("--name <name>", "Battery bank name")
  .requiredOption("--charge-level <number>", "Current charge level")
  .requiredOption("--capacity <number>", "Battery capacity")
  .requiredOption("--efficiency <number>", "Battery efficiency")
  .requiredOption("--health <number>", "Battery health")
  .action(createBattery)
  .addHelpText(
    "after",
    exampleBlock([
      "habitat battery create --name main --charge-level 80 --capacity 1000 --efficiency 0.92 --health 0.98",
    ]),
  );

batteryCommand
  .command("list")
  .description("List all battery banks.")
  .action(listBatteries)
  .addHelpText("after", exampleBlock(["habitat battery list"]));

batteryCommand
  .command("status")
  .description("Show a battery bank.")
  .argument("<name>", "Battery bank name")
  .action(statusBattery)
  .addHelpText("after", exampleBlock(["habitat battery status main"]));

batteryCommand
  .command("update")
  .description("Update a battery bank.")
  .argument("<name>", "Battery bank name")
  .option("--name <newName>", "New battery bank name")
  .option("--charge-level <number>", "Updated charge level")
  .option("--capacity <number>", "Updated capacity")
  .option("--efficiency <number>", "Updated efficiency")
  .option("--health <number>", "Updated health")
  .action(updateBattery)
  .addHelpText(
    "after",
    exampleBlock([
      "habitat battery update main --health 0.95",
      "habitat battery update main --name house",
    ]),
  );

batteryCommand
  .command("delete")
  .description("Delete a battery bank.")
  .argument("<name>", "Battery bank name")
  .action(deleteBattery)
  .addHelpText("after", exampleBlock(["habitat battery delete main"]));

batteryCommand
  .command("connect-panel")
  .description("Connect a solar panel to a battery bank.")
  .argument("<batteryName>", "Battery bank name")
  .argument("<panelName>", "Solar panel name")
  .action(connectPanelToBattery)
  .addHelpText(
    "after",
    exampleBlock([
      "habitat battery connect-panel main roof-east",
    ]),
  );

panelCommand
  .command("create")
  .description("Create a solar panel.")
  .requiredOption("--name <name>", "Solar panel name")
  .requiredOption("--efficiency <number>", "Panel efficiency")
  .requiredOption("--panel-on <true|false>", "Whether the panel is on")
  .action(createPanel)
  .addHelpText(
    "after",
    exampleBlock([
      "habitat panel create --name roof-east --efficiency 0.87 --panel-on true",
    ]),
  );

panelCommand
  .command("list")
  .description("List all solar panels.")
  .action(listPanels)
  .addHelpText("after", exampleBlock(["habitat panel list"]));

panelCommand
  .command("status")
  .description("Show a solar panel.")
  .argument("<name>", "Solar panel name")
  .action(statusPanel)
  .addHelpText("after", exampleBlock(["habitat panel status roof-east"]));

panelCommand
  .command("update")
  .description("Update a solar panel.")
  .argument("<name>", "Solar panel name")
  .option("--name <newName>", "New solar panel name")
  .option("--efficiency <number>", "Updated efficiency")
  .option("--panel-on <true|false>", "Updated panel state")
  .action(updatePanel)
  .addHelpText(
    "after",
    exampleBlock([
      "habitat panel update roof-east --panel-on false",
      "habitat panel update roof-east --name roof-west",
    ]),
  );

panelCommand
  .command("delete")
  .description("Delete a solar panel.")
  .argument("<name>", "Solar panel name")
  .action(deletePanel)
  .addHelpText("after", exampleBlock(["habitat panel delete roof-east"]));

roverCommand
  .command("create")
  .description("Create a rover.")
  .requiredOption("--name <name>", "Rover name")
  .requiredOption("--health <number>", "Rover health")
  .requiredOption("--speed <number>", "Rover speed")
  .requiredOption("--location <location>", "Rover location")
  .action(createRover)
  .addHelpText(
    "after",
    exampleBlock([
      "habitat rover create --name scout --health 95 --speed 12 --location bay-a",
    ]),
  );

roverCommand
  .command("list")
  .description("List all rovers.")
  .action(listRovers)
  .addHelpText("after", exampleBlock(["habitat rover list"]));

roverCommand
  .command("status")
  .description("Show a rover.")
  .argument("<name>", "Rover name")
  .action(statusRover)
  .addHelpText("after", exampleBlock(["habitat rover status scout"]));

roverCommand
  .command("update")
  .description("Update a rover.")
  .argument("<name>", "Rover name")
  .option("--name <newName>", "New rover name")
  .option("--health <number>", "Updated health")
  .option("--speed <number>", "Updated speed")
  .option("--location <location>", "Updated location")
  .action(updateRover)
  .addHelpText(
    "after",
    exampleBlock([
      "habitat rover update scout --location ridge-2",
      "habitat rover update scout --name pathfinder",
    ]),
  );

roverCommand
  .command("delete")
  .description("Delete a rover.")
  .argument("<name>", "Rover name")
  .action(deleteRover)
  .addHelpText("after", exampleBlock(["habitat rover delete scout"]));

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
