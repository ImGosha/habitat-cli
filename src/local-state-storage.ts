import { Database } from "bun:sqlite";
import { LocalState, normalizeState, type HabitatRegistrationRecord, type LocalSimulationState } from "./local-state.js";
import type { ModuleRecord } from "./modules.js";

type MetaRow = {
  key: string;
  value: string;
};

type InventoryRow = {
  resourceId: string;
  amount: number;
};

type ModuleRow = {
  id: string;
  blueprintId: string;
  displayName: string;
  connectedToJson: string;
  runtimeAttributesJson: string;
  capabilitiesJson: string;
};

type SimulationRow = {
  currentTick: number | null;
  lastTickAt: string | null;
  lastPowerDrawKw: number | null;
  lastEnergyRequestedKwh: number | null;
  lastEnergyDrainedKwh: number | null;
  lastPowerShortfallKwh: number | null;
};

const extraStateMetaKey = "extra_state";
const keplerMetaKey = "kepler_state";

export class SqliteLocalStateStore {
  private readonly db: Database;

  constructor(private readonly dbPath: string) {
    this.db = new Database(this.dbPath);
    this.initialize();
  }

  readState(): LocalState {
    const state: LocalState = {
      ...this.readExtraState(),
    };

    const kepler = this.readKeplerState();

    if (kepler) {
      state.kepler = kepler;
    }

    const inventory = this.readInventory();

    if (Object.keys(inventory).length > 0) {
      state.inventory = inventory;
    }

    const modules = this.readModules();

    if (modules.length > 0) {
      state.modules = modules;
    }

    const simulation = this.readSimulation();

    if (simulation) {
      state.simulation = simulation;
    }

    return normalizeState(state);
  }

  writeState(state: LocalState): void {
    const extraState = this.getExtraState(state);
    const modules = Array.isArray(state.modules) ? state.modules : [];
    const inventory = state.inventory ?? {};

    this.db.transaction(() => {
      this.writeMetaValue(keplerMetaKey, state.kepler);
      this.writeMetaValue(extraStateMetaKey, extraState);

      this.db.run("DELETE FROM inventory_entries");
      for (const [resourceId, amount] of Object.entries(inventory)) {
        this.db.run("INSERT INTO inventory_entries (resource_id, amount) VALUES (?, ?)", [resourceId, amount]);
      }

      this.db.run("DELETE FROM module_entries");
      for (const module of modules) {
        this.db.run(
          `
            INSERT INTO module_entries (
              id,
              blueprint_id,
              display_name,
              connected_to_json,
              runtime_attributes_json,
              capabilities_json
            ) VALUES (?, ?, ?, ?, ?, ?)
          `,
          [
            module.id,
            module.blueprintId,
            module.displayName,
            JSON.stringify(module.connectedTo),
            JSON.stringify(module.runtimeAttributes),
            JSON.stringify(module.capabilities),
          ],
        );
      }

      this.db.run("DELETE FROM simulation_state");
      if (state.simulation) {
        this.db.run(
          `
            INSERT INTO simulation_state (
              singleton_id,
              current_tick,
              last_tick_at,
              last_power_draw_kw,
              last_energy_requested_kwh,
              last_energy_drained_kwh,
              last_power_shortfall_kwh
            ) VALUES (1, ?, ?, ?, ?, ?, ?)
          `,
          [
            state.simulation.currentTick ?? null,
            state.simulation.lastTickAt ?? null,
            state.simulation.lastPowerDrawKw ?? null,
            state.simulation.lastEnergyRequestedKwh ?? null,
            state.simulation.lastEnergyDrainedKwh ?? null,
            state.simulation.lastPowerShortfallKwh ?? null,
          ],
        );
      }
    })();
  }

  deleteStateIfEmpty(state: LocalState): void {
    const meaningfulKeys = Object.keys(state).filter((key) => state[key] !== undefined);

    if (meaningfulKeys.length > 0) {
      this.writeState(state);
      return;
    }

    this.clearAllState();
  }

  close(): void {
    this.db.close();
  }

  private initialize(): void {
    this.db.run(
      `
        CREATE TABLE IF NOT EXISTS state_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `,
    );
    this.db.run(
      `
        CREATE TABLE IF NOT EXISTS inventory_entries (
          resource_id TEXT PRIMARY KEY,
          amount REAL NOT NULL
        )
      `,
    );
    this.db.run(
      `
        CREATE TABLE IF NOT EXISTS module_entries (
          id TEXT PRIMARY KEY,
          blueprint_id TEXT NOT NULL,
          display_name TEXT NOT NULL,
          connected_to_json TEXT NOT NULL,
          runtime_attributes_json TEXT NOT NULL,
          capabilities_json TEXT NOT NULL
        )
      `,
    );
    this.db.run(
      `
        CREATE TABLE IF NOT EXISTS simulation_state (
          singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
          current_tick INTEGER,
          last_tick_at TEXT,
          last_power_draw_kw REAL,
          last_energy_requested_kwh REAL,
          last_energy_drained_kwh REAL,
          last_power_shortfall_kwh REAL
        )
      `,
    );
  }

  private clearAllState(): void {
    this.db.transaction(() => {
      this.db.run("DELETE FROM state_meta");
      this.db.run("DELETE FROM inventory_entries");
      this.db.run("DELETE FROM module_entries");
      this.db.run("DELETE FROM simulation_state");
    })();
  }

  private readMetaValue<T>(key: string): T | undefined {
    const row = this.db.query<MetaRow, [string]>("SELECT key, value FROM state_meta WHERE key = ?").get(key);

    if (!row) {
      return undefined;
    }

    return JSON.parse(row.value) as T;
  }

  private writeMetaValue(key: string, value: unknown): void {
    if (value === undefined) {
      this.db.run("DELETE FROM state_meta WHERE key = ?", [key]);
      return;
    }

    this.db.run(
      `
        INSERT INTO state_meta (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `,
      [key, JSON.stringify(value)],
    );
  }

  private readKeplerState(): HabitatRegistrationRecord | undefined {
    return this.readMetaValue<HabitatRegistrationRecord>(keplerMetaKey);
  }

  private readExtraState(): Record<string, unknown> {
    return this.readMetaValue<Record<string, unknown>>(extraStateMetaKey) ?? {};
  }

  private readInventory(): Record<string, number> {
    const rows = this.db.query<InventoryRow, []>(
      "SELECT resource_id as resourceId, amount FROM inventory_entries ORDER BY resource_id",
    ).all();

    return rows.reduce<Record<string, number>>((inventory, row) => {
      inventory[row.resourceId] = row.amount;
      return inventory;
    }, {});
  }

  private readModules(): ModuleRecord[] {
    const rows = this.db.query<ModuleRow, []>(
      `
        SELECT
          id,
          blueprint_id as blueprintId,
          display_name as displayName,
          connected_to_json as connectedToJson,
          runtime_attributes_json as runtimeAttributesJson,
          capabilities_json as capabilitiesJson
        FROM module_entries
        ORDER BY id
      `,
    ).all();

    return rows.map((row) => ({
      id: row.id,
      blueprintId: row.blueprintId,
      displayName: row.displayName,
      connectedTo: JSON.parse(row.connectedToJson) as string[],
      runtimeAttributes: JSON.parse(row.runtimeAttributesJson) as Record<string, unknown>,
      capabilities: JSON.parse(row.capabilitiesJson) as string[],
    }));
  }

  private readSimulation(): LocalSimulationState | undefined {
    const row = this.db.query<SimulationRow, []>(
      `
        SELECT
          current_tick as currentTick,
          last_tick_at as lastTickAt,
          last_power_draw_kw as lastPowerDrawKw,
          last_energy_requested_kwh as lastEnergyRequestedKwh,
          last_energy_drained_kwh as lastEnergyDrainedKwh,
          last_power_shortfall_kwh as lastPowerShortfallKwh
        FROM simulation_state
        WHERE singleton_id = 1
      `,
    ).get();

    if (!row) {
      return undefined;
    }

    return {
      currentTick: row.currentTick ?? undefined,
      lastTickAt: row.lastTickAt ?? undefined,
      lastPowerDrawKw: row.lastPowerDrawKw ?? undefined,
      lastEnergyRequestedKwh: row.lastEnergyRequestedKwh ?? undefined,
      lastEnergyDrainedKwh: row.lastEnergyDrainedKwh ?? undefined,
      lastPowerShortfallKwh: row.lastPowerShortfallKwh ?? undefined,
    };
  }

  private getExtraState(state: LocalState): Record<string, unknown> {
    const { kepler: _kepler, inventory: _inventory, modules: _modules, simulation: _simulation, ...extraState } = state;
    return extraState;
  }
}
