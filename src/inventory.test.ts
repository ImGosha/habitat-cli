import { describe, expect, test } from "bun:test";
import {
  addInventoryResource,
  formatInventoryList,
  getInventoryAmount,
  type InventoryState,
} from "./inventory.js";

describe("inventory list", () => {
  test("formats all local inventory resources and amounts", () => {
    const state: InventoryState = {
      inventory: {
        water: 120,
        ferrite: 30,
        "silicate-glass": 15,
      },
    };

    expect(formatInventoryList(state.inventory ?? {})).toBe(
      [
        "Resource          Amount",
        "----------------  ------",
        "ferrite           30",
        "silicate-glass    15",
        "water             120",
      ].join("\n"),
    );
  });

  test("prints a friendly message when local inventory is empty", () => {
    expect(formatInventoryList({})).toBe("No local inventory resources found.");
  });
});

describe("inventory add", () => {
  test("creates a missing resource entry", () => {
    const state: InventoryState = {};

    const result = addInventoryResource(state, "silicate-glass", 45);

    expect(result).toEqual({
      resourceId: "silicate-glass",
      previousAmount: 0,
      newAmount: 45,
    });
    expect(state.inventory).toEqual({
      "silicate-glass": 45,
    });
  });

  test("increases an existing resource quantity", () => {
    const state: InventoryState = {
      inventory: {
        "conductive-ore": 18,
      },
    };

    const result = addInventoryResource(state, "conductive-ore", 12);

    expect(result).toEqual({
      resourceId: "conductive-ore",
      previousAmount: 18,
      newAmount: 30,
    });
    expect(getInventoryAmount(state.inventory ?? {}, "conductive-ore")).toBe(30);
  });
});
