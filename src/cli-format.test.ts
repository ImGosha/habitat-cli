import { describe, expect, test } from "bun:test";
import {
  formatExamples,
  formatKeyValueRows,
  formatList,
  formatRecordTable,
  formatSection,
  formatTable,
} from "./cli-format.js";

describe("cli formatting", () => {
  test("formats aligned key-value rows", () => {
    expect(
      formatKeyValueRows([
        ["Field", "Value"],
        ["Battery", "basic_battery_1"],
      ]),
    ).toBe(
      [
        "Field    Value",
        "Battery  basic_battery_1",
      ].join("\n"),
    );
  });

  test("formats table rows with headers", () => {
    expect(formatTable(["Name", "State"], [["Workshop", "idle"]])).toBe(
      [
        "Name      State",
        "--------  -----",
        "Workshop  idle",
      ].join("\n"),
    );
  });

  test("formats sections, examples, lists, and records", () => {
    expect(formatSection("Summary", "ok")).toBe(["Summary", "-------", "ok"].join("\n"));
    expect(formatExamples(["habitat status"])).toContain("Examples");
    expect(formatList(["Warning one"])).toBe("- Warning one");
    expect(formatRecordTable({ status: "online", power: 12 })).toContain("status");
  });
});
