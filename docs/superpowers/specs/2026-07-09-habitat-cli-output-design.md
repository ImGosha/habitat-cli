# Habitat CLI Output Cleanup Design

## Goal

Make Habitat CLI command output feel cleaner, more readable, and more consistent by standardizing result formatting across command responses and `--help` text.

This work covers:

- command result output
- `list`, `status`, `show`, and mutation command responses
- root help and subcommand help text

This work does not change command behavior, persistence rules, or Kepler request semantics.

## Current Problems

The CLI currently mixes:

- well-formatted tables for some list commands
- ad hoc `console.log` blocks for many status and mutation commands
- inconsistent spacing, labels, and section structure
- help text that is functional but visually uneven across command groups

The result is that the CLI feels fragmented even when the underlying features work correctly.

## Design Summary

Introduce a shared terminal-formatting module and route user-facing command output through it.

The cleanup will keep entrypoint files focused on orchestration:

- `src/index.ts` should gather data, call domain helpers, and print formatted results
- shared low-level formatting should live in a focused formatter module
- domain modules can keep deciding which fields or rows to display, but should use shared table/section helpers for a consistent visual style

## Output Rules

### List Commands

List commands remain table-first.

Applies to:

- blueprint list
- resource list
- module list
- construction status
- inventory list

Rules:

- use consistent column spacing and divider rows
- keep headers concise
- use a shared empty-state style
- avoid one-off row string building inside `src/index.ts`

### Status And Show Commands

Status and show commands become key-value tables or structured sections instead of loose line dumps.

Applies to:

- habitat status
- solar status
- module show
- tick output

Rules:

- primary summary should use aligned field/value output
- nested or verbose data should move into labeled follow-up sections
- raw JSON should only appear when it clearly adds value

### Mutation Commands

Mutation commands should return compact result summaries.

Applies to:

- register
- unregister
- construct
- module create
- module update
- module delete
- module set-status
- inventory add
- construction cancel

Rules:

- show what changed in a compact summary
- keep follow-up information grouped and easy to scan
- avoid scattered sentence-by-sentence logging when a table or short section is clearer

### Help Text

Help output should use one visual structure across the CLI.

Rules:

- consistent section ordering
- clean examples blocks
- readable notes/contract sections
- keep text concise and practical

The root help and subcommand help should feel like one system instead of separate styles.

## Formatting Architecture

Add a new shared module:

- `src/cli-format.ts`

Planned responsibilities:

- format key-value tables
- format generic row tables
- format labeled sections
- format examples blocks
- format bullet-style warnings or next-step notes

The module should stay ASCII-only and terminal-friendly.

## Module Responsibilities

### `src/cli-format.ts`

Owns reusable formatting primitives only.

Examples:

- `formatKeyValueTable(...)`
- `formatTable(...)`
- `formatSection(...)`
- `formatExamples(...)`
- `formatList(...)`

### Domain Modules

Existing domain modules may keep higher-level formatting functions where that already fits the codebase:

- `src/blueprints.ts`
- `src/resources.ts`
- `src/power.ts`
- `src/construction.ts`
- `src/inventory.ts`

But they should reuse shared formatting primitives so column/header style stays consistent.

### `src/index.ts`

Should primarily:

- call domain logic
- assemble summary data
- invoke formatters
- print final output

It should stop being the place where most custom string layout is handwritten.

## Command-Specific Expectations

### Tick

`habitat tick <count>` should become a structured multi-section output:

- summary table for tick count, current tick, draw, drain, battery, and solar generation
- warning section for shortfalls
- no-charge reasons as a compact list
- completed construction modules as a table or short structured section

### Construct Dry Run

`habitat construct <blueprintId> --dry-run` should be split into:

- overview summary
- checks table
- materials table
- resulting inventory table

### Module Show

`habitat module show <moduleId>` should move away from a long line-by-line dump and instead use:

- summary section
- connections/capabilities section
- runtime attributes section

### Habitat Status

`habitat status` should use a compact key-value table and keep module count and registration metadata aligned and easy to scan.

## Error And Warning Scope

This design does not include a broad rewrite of all error messaging.

However, warnings printed as part of successful commands may be reformatted if needed for readability.

## Testing Plan

Add or update tests for:

- shared formatter helpers
- affected domain formatter outputs
- help text and key command output where practical

Verification should include:

- `bun test`
- `bun run check`
- live WSL command checks for representative help/output surfaces

## Risks

- snapshot-style output tests may need broad updates
- formatting changes can accidentally make output noisier if sections are overused
- centralizing formatting too aggressively could blur domain boundaries if helper APIs become too abstract

## Guardrails

- keep formatting helpers small and obvious
- prefer plain ASCII tables and labels
- do not change command semantics while cleaning output
- preserve existing discoverability content while improving readability

## Recommended Implementation Order

1. Add shared formatter primitives
2. Migrate existing table-producing modules to shared helpers where appropriate
3. Refactor `src/index.ts` status/show/mutation outputs
4. Clean up root help and subcommand help blocks
5. Verify output in WSL against representative commands
