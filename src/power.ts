import type { ModuleRecord } from "./modules.js";
import type { SolarIrradiance } from "./solar.js";
import { formatTable } from "./cli-format.js";

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

export type SolarChargeResult = {
  batteryId?: string;
  generatedKwh: number;
  batteryEnergyBeforeKwh?: number;
  batteryEnergyAfterKwh?: number;
  noChargeReason?: string;
  solarModuleCount: number;
  irradiance: SolarIrradiance;
};

export type PowerSimulationResult = TickResult & {
  solarGeneratedKwh: number;
  solarNoChargeReasons: string[];
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

  const totalPowerDrawKw = calculateTotalPowerDrawKw(modules);
  const oneTickEnergyKwh = totalPowerDrawKw / 3600;

  return [
    formatTable(
      ["Module", "State", "Power Draw"],
      statuses.map((status) => [status.name, status.state, `${formatNumber(status.powerDrawKw)} kW`]),
    ),
    "",
    formatTable(
      ["Metric", "Value"],
      [
        ["Total Current Power Draw", `${formatNumber(totalPowerDrawKw)} kW`],
        ["Energy Cost For One Tick", `${formatNumber(oneTickEnergyKwh)} kWh`],
      ],
    ),
  ].join("\n");
}

export function findPrimaryBattery(modules: ModuleRecord[] = []): ModuleRecord | undefined {
  return modules.find(
    (module) =>
      module.capabilities.includes("power-storage") &&
      getFiniteNumber(module.runtimeAttributes.currentEnergyKwh) !== undefined,
  );
}

function hasCapability(module: ModuleRecord, capability: string): boolean {
  return module.capabilities.includes(capability);
}

function getModuleStatus(module: ModuleRecord): string {
  return typeof module.runtimeAttributes.status === "string" ? module.runtimeAttributes.status : "";
}

function getModuleEnergyStorageKwh(module: ModuleRecord): number | undefined {
  return getFiniteNumber(module.runtimeAttributes.energyStorageKwh);
}

function getModulePowerGenerationKw(module: ModuleRecord): number | undefined {
  return getFiniteNumber(module.runtimeAttributes.powerGenerationKw);
}

function findFirstOnlineBattery(modules: ModuleRecord[] = []): ModuleRecord | undefined {
  return modules.find(
    (module) =>
      hasCapability(module, "power-storage") &&
      getModuleStatus(module) === "online" &&
      getFiniteNumber(module.runtimeAttributes.currentEnergyKwh) !== undefined &&
      getModuleEnergyStorageKwh(module) !== undefined,
  );
}

function findOnlineSolarModules(modules: ModuleRecord[] = []): ModuleRecord[] {
  return modules.filter((module) => hasCapability(module, "solar-generation") && getModuleStatus(module) === "online");
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

export function applySolarCharging(
  state: PowerTickState,
  tickCount: number,
  irradiance: SolarIrradiance,
): SolarChargeResult {
  const onlineSolarModules = findOnlineSolarModules(state.modules);

  if (onlineSolarModules.length === 0) {
    return {
      generatedKwh: 0,
      noChargeReason: "No online solar modules were available for charging.",
      solarModuleCount: 0,
      irradiance,
    };
  }

  const battery = findFirstOnlineBattery(state.modules);

  if (!battery) {
    return {
      generatedKwh: 0,
      noChargeReason: "No online battery was available for solar charging.",
      solarModuleCount: onlineSolarModules.length,
      irradiance,
    };
  }

  if (irradiance.wPerM2 <= 0) {
    return {
      generatedKwh: 0,
      noChargeReason: "No solar charging occurred because solar irradiance was 0 W/m^2.",
      solarModuleCount: onlineSolarModules.length,
      irradiance,
    };
  }

  const totalGenerationKw = onlineSolarModules.reduce((total, module) => total + (getModulePowerGenerationKw(module) ?? 0), 0);

  if (totalGenerationKw <= 0) {
    return {
      generatedKwh: 0,
      noChargeReason: "No online solar modules reported usable powerGenerationKw.",
      solarModuleCount: onlineSolarModules.length,
      irradiance,
    };
  }

  const batteryEnergyBeforeKwh = getFiniteNumber(battery.runtimeAttributes.currentEnergyKwh) ?? 0;
  const energyStorageKwh = getModuleEnergyStorageKwh(battery) ?? batteryEnergyBeforeKwh;
  const generatedKwh = totalGenerationKw * (irradiance.wPerM2 / 900) * 0.5 * (tickCount / 3600);
  const batteryEnergyAfterKwh = Math.min(energyStorageKwh, batteryEnergyBeforeKwh + generatedKwh);

  battery.runtimeAttributes.currentEnergyKwh = batteryEnergyAfterKwh;

  return {
    batteryId: battery.id,
    generatedKwh,
    batteryEnergyBeforeKwh,
    batteryEnergyAfterKwh,
    solarModuleCount: onlineSolarModules.length,
    irradiance,
  };
}

export async function runPowerSimulation(
  state: PowerTickState,
  tickCount: number,
  loadSolarIrradiance: () => Promise<SolarIrradiance>,
  now = new Date(),
): Promise<PowerSimulationResult> {
  let latestResult: TickResult | undefined;
  let totalEnergyRequestedKwh = 0;
  let totalEnergyDrainedKwh = 0;
  let totalPowerShortfallKwh = 0;
  let solarGeneratedKwh = 0;
  const solarNoChargeReasonSet = new Set<string>();

  for (let currentTick = 0; currentTick < tickCount; currentTick += 1) {
    latestResult = applyPowerTick(state, 1, now);
    totalEnergyRequestedKwh += latestResult.energyRequestedKwh;
    totalEnergyDrainedKwh += latestResult.energyDrainedKwh;
    totalPowerShortfallKwh += latestResult.powerShortfallKwh;

    try {
      const irradiance = await loadSolarIrradiance();
      const chargeResult = applySolarCharging(state, 1, irradiance);
      solarGeneratedKwh += chargeResult.generatedKwh;

      if (chargeResult.noChargeReason) {
        solarNoChargeReasonSet.add(chargeResult.noChargeReason);
      }
    } catch {
      solarNoChargeReasonSet.add(
        "No solar charging occurred because the solar irradiance could not be retrieved.",
      );
    }
  }

  if (!latestResult) {
    throw new Error("Tick count must be at least 1.");
  }

  const battery = findPrimaryBattery(state.modules);
  const batteryEnergyRemainingKwh =
    battery && getFiniteNumber(battery.runtimeAttributes.currentEnergyKwh) !== undefined
      ? (getFiniteNumber(battery.runtimeAttributes.currentEnergyKwh) ?? latestResult.batteryEnergyRemainingKwh)
      : latestResult.batteryEnergyRemainingKwh;

  return {
    ...latestResult,
    tickCount,
    energyRequestedKwh: totalEnergyRequestedKwh,
    energyDrainedKwh: totalEnergyDrainedKwh,
    powerShortfallKwh: totalPowerShortfallKwh,
    batteryEnergyRemainingKwh,
    solarGeneratedKwh,
    solarNoChargeReasons: [...solarNoChargeReasonSet],
  };
}
