import { formatTable } from "./cli-format.js";

export type Inventory = Record<string, number>;

export type InventoryState = {
  inventory?: Inventory;
} & Record<string, unknown>;

export type InventoryAddResult = {
  resourceId: string;
  previousAmount: number;
  newAmount: number;
};

export type InventoryRemoveResult = InventoryAddResult;

function formatAmount(value: number): string {
  return Number(value.toFixed(6)).toString();
}

export function getInventoryAmount(inventory: Inventory, resourceId: string): number {
  const value = inventory[resourceId];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function addInventoryResource(
  state: InventoryState,
  resourceId: string,
  amount: number,
): InventoryAddResult {
  const inventory = { ...(state.inventory ?? {}) };
  const previousAmount = getInventoryAmount(inventory, resourceId);
  const newAmount = previousAmount + amount;

  inventory[resourceId] = newAmount;
  state.inventory = inventory;

  return {
    resourceId,
    previousAmount,
    newAmount,
  };
}

export function removeInventoryResource(
  state: InventoryState,
  resourceId: string,
  amount: number,
): InventoryRemoveResult {
  const inventory = { ...(state.inventory ?? {}) };
  const previousAmount = getInventoryAmount(inventory, resourceId);
  const newAmount = Math.max(0, previousAmount - amount);

  inventory[resourceId] = newAmount;
  state.inventory = inventory;

  return {
    resourceId,
    previousAmount,
    newAmount,
  };
}

export function formatInventoryList(inventory: Inventory): string {
  const resourceIds = Object.keys(inventory).sort();

  if (resourceIds.length === 0) {
    return "No local inventory resources found.";
  }

  return formatTable(
    ["Resource", "Amount"],
    resourceIds.map((resourceId) => [resourceId, formatAmount(getInventoryAmount(inventory, resourceId))]),
  );
}
