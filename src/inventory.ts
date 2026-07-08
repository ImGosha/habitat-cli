export type Inventory = Record<string, number>;

export type InventoryState = {
  inventory?: Inventory;
} & Record<string, unknown>;

export type InventoryAddResult = {
  resourceId: string;
  previousAmount: number;
  newAmount: number;
};

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

export function formatInventoryList(inventory: Inventory): string {
  const resourceIds = Object.keys(inventory).sort();

  if (resourceIds.length === 0) {
    return "No local inventory resources found.";
  }

  const rows = resourceIds.map((resourceId) => ({
    resourceId,
    amount: formatAmount(getInventoryAmount(inventory, resourceId)),
  }));
  const resourceWidth = Math.max("Resource".length, ...rows.map((row) => row.resourceId.length), 16);
  const amountWidth = Math.max("Amount".length, ...rows.map((row) => row.amount.length));
  const lines = [
    `${"Resource".padEnd(resourceWidth)}  ${"Amount".padEnd(amountWidth)}`,
    `${"-".repeat(resourceWidth)}  ${"-".repeat(amountWidth)}`,
  ];

  for (const row of rows) {
    lines.push(`${row.resourceId.padEnd(resourceWidth)}  ${row.amount}`);
  }

  return lines.join("\n");
}
