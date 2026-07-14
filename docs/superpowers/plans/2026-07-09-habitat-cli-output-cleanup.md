# Habitat CLI Output Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Habitat CLI output and help text cleaner, more readable, and more consistent with shared table-first formatting.

**Architecture:** Add a small shared CLI formatting module, migrate existing formatter functions onto the shared primitives, and refactor `src/index.ts` to print structured sections instead of ad hoc line-by-line output. Keep behavior unchanged while standardizing tables, summaries, and help examples.

**Tech Stack:** TypeScript, Bun test runner, Commander, ASCII terminal output

## Global Constraints

- Keep output ASCII-only and terminal-friendly.
- Do not change command semantics, persistence rules, or Kepler request behavior.
- Keep `src/index.ts` focused on orchestration instead of low-level layout logic.
- Reuse the project’s existing Bun/TypeScript testing style.

---

### Task 1: Add shared CLI formatting primitives

**Files:**
- Create: `C:\Users\mrogi\OneDrive\Documents\habitat-cli\src\cli-format.ts`
- Test: `C:\Users\mrogi\OneDrive\Documents\habitat-cli\src\cli-format.test.ts`

**Interfaces:**
- Consumes: none
- Produces: `formatKeyValueRows(rows)`, `formatTable(columns, rows)`, `formatSection(title, body)`, `formatExamples(lines)`, `formatList(items)`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { formatExamples, formatKeyValueRows, formatList, formatSection, formatTable } from "./cli-format.js";

describe("cli formatting", () => {
  test("formats aligned key-value rows", () => {
    expect(
      formatKeyValueRows([
        ["Field", "Value"],
        ["Battery", "basic_battery_1"],
      ]),
    ).toContain("Battery");
  });

  test("formats table rows with headers", () => {
    expect(
      formatTable(["Name", "State"], [["Workshop", "idle"]]),
    ).toContain("Workshop");
  });

  test("formats sections, examples, and lists", () => {
    expect(formatSection("Summary", "ok")).toContain("Summary");
    expect(formatExamples(["habitat status"])).toContain("Examples");
    expect(formatList(["Warning one"])).toContain("- Warning one");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `wsl bash -ilc "cd /mnt/c/Users/mrogi/OneDrive/Documents/habitat-cli && bun test src/cli-format.test.ts"`
Expected: FAIL because `src/cli-format.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export function formatKeyValueRows(rows: Array<[string, string]>): string { /* aligned rows */ }
export function formatTable(headers: string[], rows: string[][]): string { /* ASCII table */ }
export function formatSection(title: string, body: string): string { /* titled block */ }
export function formatExamples(lines: string[]): string { /* examples block */ }
export function formatList(items: string[]): string { /* dashed list */ }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `wsl bash -ilc "cd /mnt/c/Users/mrogi/OneDrive/Documents/habitat-cli && bun test src/cli-format.test.ts"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli-format.ts src/cli-format.test.ts
git commit -m "refactor: add shared cli formatting helpers"
```

### Task 2: Migrate existing formatter modules onto shared helpers

**Files:**
- Modify: `C:\Users\mrogi\OneDrive\Documents\habitat-cli\src\blueprints.ts`
- Modify: `C:\Users\mrogi\OneDrive\Documents\habitat-cli\src\resources.ts`
- Modify: `C:\Users\mrogi\OneDrive\Documents\habitat-cli\src\inventory.ts`
- Modify: `C:\Users\mrogi\OneDrive\Documents\habitat-cli\src\power.ts`
- Modify: `C:\Users\mrogi\OneDrive\Documents\habitat-cli\src\construction.ts`
- Modify: `C:\Users\mrogi\OneDrive\Documents\habitat-cli\src\solar.ts`
- Test: `C:\Users\mrogi\OneDrive\Documents\habitat-cli\src\blueprints.test.ts`
- Test: `C:\Users\mrogi\OneDrive\Documents\habitat-cli\src\resources.test.ts`
- Test: `C:\Users\mrogi\OneDrive\Documents\habitat-cli\src\inventory.test.ts`
- Test: `C:\Users\mrogi\OneDrive\Documents\habitat-cli\src\power.test.ts`
- Test: `C:\Users\mrogi\OneDrive\Documents\habitat-cli\src\construction.test.ts`
- Test: `C:\Users\mrogi\OneDrive\Documents\habitat-cli\src\solar.test.ts`

**Interfaces:**
- Consumes: shared formatting helpers from `src/cli-format.ts`
- Produces: updated `formatBlueprintList`, `formatResourceList`, `formatInventoryList`, `formatModulePowerStatusTable`, `formatConstructionStatus`, `formatSolarStatus`

- [ ] **Step 1: Update formatter tests first**

```ts
expect(formatInventoryList({ ferrite: 3 })).toContain("Resource");
expect(formatSolarStatus({ wPerM2: 540, condition: "dusty" })).toContain("Condition");
```

- [ ] **Step 2: Run targeted tests to verify failures**

Run: `wsl bash -ilc "cd /mnt/c/Users/mrogi/OneDrive/Documents/habitat-cli && bun test src/blueprints.test.ts src/resources.test.ts src/inventory.test.ts src/power.test.ts src/construction.test.ts src/solar.test.ts"`
Expected: FAIL on updated string expectations until formatters are migrated.

- [ ] **Step 3: Implement shared-helper-backed formatting**

```ts
import { formatKeyValueRows, formatTable } from "./cli-format.js";
```

Use shared helpers inside each formatter while preserving each command’s current data fields.

- [ ] **Step 4: Run targeted tests to verify they pass**

Run: `wsl bash -ilc "cd /mnt/c/Users/mrogi/OneDrive/Documents/habitat-cli && bun test src/blueprints.test.ts src/resources.test.ts src/inventory.test.ts src/power.test.ts src/construction.test.ts src/solar.test.ts"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/blueprints.ts src/resources.ts src/inventory.ts src/power.ts src/construction.ts src/solar.ts src/*.test.ts
git commit -m "refactor: standardize cli formatter modules"
```

### Task 3: Refactor entrypoint command outputs and help text

**Files:**
- Modify: `C:\Users\mrogi\OneDrive\Documents\habitat-cli\src\index.ts`
- Test: `C:\Users\mrogi\OneDrive\Documents\habitat-cli\src\index-output.test.ts`

**Interfaces:**
- Consumes: shared formatting helpers and domain formatter functions
- Produces: formatted output for status/show/mutation commands and cleaner help section blocks

- [ ] **Step 1: Write focused failing tests for representative output**

```ts
test("formats habitat status as a summary table", () => {
  expect(renderedStatus).toContain("Field");
});

test("formats tick output as structured sections", () => {
  expect(renderedTick).toContain("Solar Generated");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `wsl bash -ilc "cd /mnt/c/Users/mrogi/OneDrive/Documents/habitat-cli && bun test src/index-output.test.ts"`
Expected: FAIL until `src/index.ts` output assembly is refactored or extracted for testing.

- [ ] **Step 3: Refactor output assembly**

```ts
function formatRegistrationSummary(...) { /* key-value section */ }
function formatTickSummary(...) { /* summary + warnings + completions */ }
function formatMutationResult(...) { /* compact result blocks */ }
```

Update help/example blocks to use the shared section/example helpers.

- [ ] **Step 4: Run tests to verify pass**

Run: `wsl bash -ilc "cd /mnt/c/Users/mrogi/OneDrive/Documents/habitat-cli && bun test src/index-output.test.ts"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/index-output.test.ts
git commit -m "refactor: clean up habitat cli command output"
```

### Task 4: Full verification in WSL

**Files:**
- Modify: none unless verification reveals regressions

**Interfaces:**
- Consumes: all previous tasks
- Produces: verified test/build/help/output evidence

- [ ] **Step 1: Run full automated verification**

Run: `wsl bash -ilc "cd /mnt/c/Users/mrogi/OneDrive/Documents/habitat-cli && bun test && bun run check"`
Expected: all tests pass and TypeScript check passes

- [ ] **Step 2: Run representative live CLI output checks**

Run:

```bash
wsl bash -ilc "cd /mnt/c/Users/mrogi/OneDrive/Documents/habitat-cli && bun run src/index.ts --help"
wsl bash -ilc "cd /mnt/c/Users/mrogi/OneDrive/Documents/habitat-cli && bun run src/index.ts module status"
wsl bash -ilc "cd /mnt/c/Users/mrogi/OneDrive/Documents/habitat-cli && bun run src/index.ts solar status"
```

Expected: cleaner sectioned help and readable table-based output

- [ ] **Step 3: Fix any discovered formatting regressions**

Use the smallest code change needed if any representative output looks broken.

- [ ] **Step 4: Re-run verification**

Run: `wsl bash -ilc "cd /mnt/c/Users/mrogi/OneDrive/Documents/habitat-cli && bun test && bun run check"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: verify habitat cli output cleanup"
```
