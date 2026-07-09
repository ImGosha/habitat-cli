import { describe, expect, test } from "bun:test";
import {
  findModuleById,
  formatModuleList,
  formatModuleListItem,
  getShortModuleId,
  isModuleRuntimeStatus,
  setModuleRuntimeStatus,
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

  test("formats module lists as a readable table", () => {
    expect(formatModuleList([moduleRecord])).toBe(
      [
        "Module ID         Display Name    Blueprint       Status",
        "----------------  --------------  --------------  ------",
        "command_module_1  Command Module  command-module  active",
      ].join("\n"),
    );
  });

  test("finds modules by either full ID or short ID", () => {
    const modules = [moduleRecord];

    expect(findModuleById(modules, "habitat_123_command_module_1")).toBe(moduleRecord);
    expect(findModuleById(modules, "command_module_1")).toBe(moduleRecord);
  });

  test("finds modules with hyphenated short IDs", () => {
    const module: ModuleRecord = {
      ...moduleRecord,
      id: "habitat_123_workshop_fabricator_1",
      blueprintId: "workshop-fabricator",
      displayName: "Workshop Fabricator",
    };

    expect(findModuleById([module], "workshop-fabricator-1")).toBe(module);
  });
});

describe("module runtime status", () => {
  test("validates allowed module runtime statuses", () => {
    expect(isModuleRuntimeStatus("offline")).toBe(true);
    expect(isModuleRuntimeStatus("idle")).toBe(true);
    expect(isModuleRuntimeStatus("online")).toBe(true);
    expect(isModuleRuntimeStatus("active")).toBe(true);
    expect(isModuleRuntimeStatus("damaged")).toBe(true);
    expect(isModuleRuntimeStatus("sleepy")).toBe(false);
  });

  test("updates only runtimeAttributes.status", () => {
    const module: ModuleRecord = {
      ...moduleRecord,
      runtimeAttributes: {
        status: "idle",
        health: 100,
        powerDrawKw: {
          idle: 1,
          active: 4,
        },
      },
    };

    setModuleRuntimeStatus(module, "active");

    expect(module).toEqual({
      ...moduleRecord,
      runtimeAttributes: {
        status: "active",
        health: 100,
        powerDrawKw: {
          idle: 1,
          active: 4,
        },
      },
    });
  });
});
