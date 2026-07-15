import type { CarriedResourceRecord, LocalEvaState } from "./local-state.js";

export type WorldCollectionRecord = {
  x: number;
  y: number;
  resourceType: string;
  unit: "kg";
  collectedKg: number;
  remainingKg: number;
};

export function getCarriedMassKg(eva: LocalEvaState): number {
  return eva.carriedResources.reduce((total, resource) => total + resource.quantityKg, 0);
}

export function validateCollectionQuantity(quantityKg: unknown): number {
  if (typeof quantityKg !== "number" || !Number.isInteger(quantityKg) || quantityKg <= 0) {
    throw new Error("quantityKg must be a positive whole number.");
  }

  return quantityKg;
}

export function ensureCarryCapacity(eva: LocalEvaState, quantityKg: number): void {
  if (getCarriedMassKg(eva) + quantityKg > eva.carryCapacityKg) {
    throw new Error("Collecting that quantity would exceed EVA carrying capacity.");
  }
}

export function addCarriedResource(eva: LocalEvaState, collection: WorldCollectionRecord): LocalEvaState {
  const existing = eva.carriedResources.find((resource) => resource.resourceType === collection.resourceType);

  if (existing) {
    existing.quantityKg += collection.collectedKg;
    return eva;
  }

  eva.carriedResources.push({
    resourceType: collection.resourceType,
    quantityKg: collection.collectedKg,
  } satisfies CarriedResourceRecord);
  return eva;
}
