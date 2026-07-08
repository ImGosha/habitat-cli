import type { ModuleRecord } from "./modules.js";

export type SimulationState = {
  currentTick: number;
  lastTickAt: string;
  lastPowerDrawKw: number;
  lastEnergyRequestedKwh: number;
  lastEnergyDrainedKwh: number;
  lastPowerShortfallKwh: number;
};

export type PowerTickState = {
  modules?: ModuleRecord[];
  simulation?: Partial<SimulationState>;
} & Record<string, unknown>;

export type TickResult = {
  tickCount: number;
  currentTick: number;
  totalPowerDrawKw: number;
  energyRequestedKwh: number;
  energyDrainedKwh: number;
  powerShortfallKwh: number;
  batteryId: string;
  batteryEnergyRemainingKwh: number;
};

export type ModulePowerStatus = {
  name: string;
  state: string;
  powerDrawKw: number;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function getModulePowerDrawKw(module: ModuleRecord): number {
  const powerDrawKw = module.runtimeAttributes.powerDrawKw;
  const numericPowerDraw = getFiniteNumber(powerDrawKw);

  if (numericPowerDraw !== undefined) {
    return numericPowerDraw;
  }

  if (!isPlainObject(powerDrawKw)) {
    return 0;
  }

  const status = typeof module.runtimeAttributes.status === "string" ? module.runtimeAttributes.status : "";
  return getFiniteNumber(powerDrawKw[status]) ?? 0;
}

export function calculateTotalPowerDrawKw(modules: ModuleRecord[] = []): number {
  return modules.reduce((total, module) => total + getModulePowerDrawKw(module), 0);
}

function formatNumber(value: number): string {
  return Number(value.toFixed(6)).toString();
}

export function getModulePowerStatuses(modules: ModuleRecord[] = []): ModulePowerStatus[] {
  return modules.map((module) => ({
    name: module.displayName,
    state: typeof module.runtimeAttributes.status === "string" ? module.runtimeAttributes.status : "unknown",
    powerDrawKw: getModulePowerDrawKw(module),
  }));
}

export function formatModulePowerStatusTable(modules: ModuleRecord[] = []): string {
  const statuses = getModulePowerStatuses(modules);
  const moduleWidth = Math.max("Module".length, ...statuses.map((status) => status.name.length));
  const stateWidth = Math.max("State".length, ...statuses.map((status) => status.state.length));
  const powerHeader = "Power Draw";
  const lines = [
    `${"Module".padEnd(moduleWidth)}  ${"State".padEnd(stateWidth)}  ${powerHeader}`,
    `${"-".repeat(moduleWidth)}  ${"-".repeat(stateWidth)}  ${"-".repeat(powerHeader.length)}`,
  ];

  for (const status of statuses) {
    lines.push(
      `${status.name.padEnd(moduleWidth)}  ${status.state.padEnd(stateWidth)}  ${formatNumber(status.powerDrawKw)} kW`,
    );
  }

  const totalPowerDrawKw = calculateTotalPowerDrawKw(modules);
  const oneTickEnergyKwh = totalPowerDrawKw / 3600;

  lines.push("");
  lines.push(`Total Current Power Draw: ${formatNumber(totalPowerDrawKw)} kW`);
  lines.push(`Energy Cost For One Tick: ${formatNumber(oneTickEnergyKwh)} kWh`);

  return lines.join("\n");
}

export function findPrimaryBattery(modules: ModuleRecord[] = []): ModuleRecord | undefined {
  return modules.find(
    (module) =>
      module.capabilities.includes("power-storage") &&
      getFiniteNumber(module.runtimeAttributes.currentEnergyKwh) !== undefined,
  );
}

export function applyPowerTick(state: PowerTickState, tickCount: number, now = new Date()): TickResult {
  const battery = findPrimaryBattery(state.modules);

  if (!battery) {
    throw new Error("No battery module with currentEnergyKwh was found.");
  }

  const totalPowerDrawKw = calculateTotalPowerDrawKw(state.modules);
  const energyRequestedKwh = (totalPowerDrawKw * tickCount) / 3600;
  const currentEnergyKwh = getFiniteNumber(battery.runtimeAttributes.currentEnergyKwh) ?? 0;
  const energyDrainedKwh = Math.min(currentEnergyKwh, energyRequestedKwh);
  const batteryEnergyRemainingKwh = currentEnergyKwh - energyDrainedKwh;
  const powerShortfallKwh = energyRequestedKwh - energyDrainedKwh;
  const currentTick = (getFiniteNumber(state.simulation?.currentTick) ?? 0) + tickCount;

  battery.runtimeAttributes.currentEnergyKwh = batteryEnergyRemainingKwh;
  state.simulation = {
    currentTick,
    lastTickAt: now.toISOString(),
    lastPowerDrawKw: totalPowerDrawKw,
    lastEnergyRequestedKwh: energyRequestedKwh,
    lastEnergyDrainedKwh: energyDrainedKwh,
    lastPowerShortfallKwh: powerShortfallKwh,
  };

  return {
    tickCount,
    currentTick,
    totalPowerDrawKw,
    energyRequestedKwh,
    energyDrainedKwh,
    powerShortfallKwh,
    batteryId: battery.id,
    batteryEnergyRemainingKwh,
  };
}
