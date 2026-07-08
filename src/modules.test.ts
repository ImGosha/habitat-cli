import { describe, expect, test } from "bun:test";
import {
  findModuleById,
  formatModuleListItem,
  getShortModuleId,
  type ModuleRecord,
} from "./modules.js";

const moduleRecord: ModuleRecord = {
  id: "habitat_123_command_module_1",
  blueprintId: "command-module",
  displayName: "Command Module",
  connectedTo: [],
  runtimeAttributes: {
    status: "active",
    health: 100,
  },
  capabilities: ["command"],
};

describe("module ID display", () => {
  test("removes the repeated habitat prefix from starter module IDs", () => {
    expect(getShortModuleId(moduleRecord)).toBe("command_module_1");
  });

  test("formats module list rows with the short module ID", () => {
    expect(formatModuleListItem(moduleRecord)).toBe("command_module_1: Command Module (command-module) status=active");
  });

  test("finds modules by either full ID or short ID", () => {
    const modules = [moduleRecord];

    expect(findModuleById(modules, "habitat_123_command_module_1")).toBe(moduleRecord);
    expect(findModuleById(modules, "command_module_1")).toBe(moduleRecord);
  });
});
