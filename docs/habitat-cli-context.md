# Habitat CLI Context

## Purpose

This project is a Bun + TypeScript command-line app named `habitat`.

It currently mixes:

- early local lab objects: `batteryBanks`, `solarPanels`, `rovers`
- Kepler registration and catalog features
- local habitat module management
- local inventory
- local construction jobs
- local tick-based power simulation
- live Kepler solar irradiance reads

The executable entrypoint is [`src/index.ts`](/C:/Users/mrogi/OneDrive/Documents/habitat-cli/src/index.ts).

## Runtime And Tooling

- Package manager: Bun
- CLI parser: Commander.js
- Env loading: `dotenv`
- Typecheck script: `bun run check`
- Tests: `bun test`
- Local executable name: `habitat`

From [`package.json`](/C:/Users/mrogi/OneDrive/Documents/habitat-cli/package.json):

- package name: `habitat`
- version: `0.1.0`
- bin target: `./src/index.ts`

## Current Project Structure

- [`src/index.ts`](/C:/Users/mrogi/OneDrive/Documents/habitat-cli/src/index.ts): Commander wiring, local state reads/writes, Kepler registration commands, and top-level command orchestration
- [`src/modules.ts`](/C:/Users/mrogi/OneDrive/Documents/habitat-cli/src/modules.ts): module types, short IDs, module lookup, module runtime status helpers
- [`src/inventory.ts`](/C:/Users/mrogi/OneDrive/Documents/habitat-cli/src/inventory.ts): local inventory helpers and inventory table formatting
- [`src/construction.ts`](/C:/Users/mrogi/OneDrive/Documents/habitat-cli/src/construction.ts): dry run, start, cancel, active-job display, inventory spending, and construction completion
- [`src/power.ts`](/C:/Users/mrogi/OneDrive/Documents/habitat-cli/src/power.ts): power draw math, battery drain, solar charging, module power table, simulation tick loop
- [`src/blueprints.ts`](/C:/Users/mrogi/OneDrive/Documents/habitat-cli/src/blueprints.ts): Kepler blueprint catalog fetch + formatting
- [`src/resources.ts`](/C:/Users/mrogi/OneDrive/Documents/habitat-cli/src/resources.ts): Kepler resource catalog fetch + formatting
- [`src/solar.ts`](/C:/Users/mrogi/OneDrive/Documents/habitat-cli/src/solar.ts): Kepler solar irradiance fetch + formatting
- [`src/cli-format.ts`](/C:/Users/mrogi/OneDrive/Documents/habitat-cli/src/cli-format.ts): shared terminal formatting helpers

## Local State

The main local state file is:

- [`habitat.json`](/C:/Users/mrogi/OneDrive/Documents/habitat-cli/habitat.json)

This file currently stores:

- legacy `batteryBanks`
- legacy `solarPanels`
- legacy `rovers`
- `kepler` registration data
- local `modules`
- local `inventory`
- local `simulation`

Important boundary:

- Kepler catalog and world data are read from the server.
- Habitat inventory, modules, construction jobs, and tick state are stored locally in `habitat.json`.

## Environment Variables

The CLI loads a repo-local `.env` from the project root.

Expected variables:

- `KEPLER_BASE_URL`
- `KEPLER_PLANET_TOKEN`

The `.env` file should stay local and be ignored by Git.

## Current Command Surface

### Kepler Registration

- `habitat register --name "<name>"`
- `habitat status`
- `habitat unregister`

Behavior:

- `register` sends `displayName` and a generated `habitatUuid` to Kepler
- stores returned `habitatId`, `starterModules`, and `blueprints` locally
- hydrates local `modules` from `starterModules`

### Blueprint Catalog

- `habitat blueprint list`
- `habitat blueprint show <blueprintId>`

Behavior:

- read-only Kepler catalog commands
- do not change local habitat state

### Resource Catalog

- `habitat resource list`

Behavior:

- read-only Kepler catalog command
- lists possible resource types in the Kepler world
- does not mean those resources are owned locally

### Solar

- `habitat solar status`

Behavior:

- reads live solar irradiance from Kepler

### Local Modules

- `habitat module list`
- `habitat module status`
- `habitat module show <moduleId>`
- `habitat module set-status <moduleId> <status>`
- `habitat module create --blueprint-id <blueprintId> --name "<name>"`
- `habitat module update <moduleId> [--name ...] [--status ...] [--health ...]`
- `habitat module delete <moduleId>`

Allowed module runtime statuses:

- `offline`
- `idle`
- `online`
- `active`
- `damaged`

Module lookup behavior:

- commands accept either the full module ID or the shortened module ID form

### Local Inventory

- `habitat inventory list`
- `habitat inventory add <resourceId> <amount>`

Behavior:

- local only
- used by construction
- separate from the Kepler resource catalog

### Local Construction

- `habitat construct <blueprintId> --dry-run`
- `habitat construct <blueprintId>`
- `habitat construction status`
- `habitat construction cancel <facilityModuleId>`

Behavior:

- blueprint definitions come from Kepler
- construction jobs live locally
- dry run does not mutate local files
- real construction spends local inventory and attaches a `constructionJob` to a workshop fabricator
- completion happens later through ticks, not immediately

### Local Tick Simulation

- `habitat tick <count>`

Behavior:

- advances one-second ticks locally
- drains battery energy based on module power draw
- reads live Kepler solar irradiance during ticks
- can charge an online battery from online solar modules
- advances active construction jobs
- creates completed output modules when remaining ticks reach `0`

## Kepler Endpoints In Use

Based on the current source:

- `POST /habitats/register`
- `GET /habitats/{habitatId}/registration`
- `DELETE /habitats/{habitatId}`
- `GET /catalog/blueprints`
- `GET /catalog/blueprints/{blueprintId}`
- `GET /catalog/resources`
- `GET /world/solar-irradiance`

Auth pattern:

- Bearer token from `KEPLER_PLANET_TOKEN`

## Construction Rules In The Current Implementation

Construction is currently local-only after the blueprint is fetched.

Before a build can start, the current code requires:

- the blueprint output item type must be `module`
- the blueprint must have valid `buildTicks`
- the required facility must exist
- an eligible facility must be available
- supply cache must be `online` or `active`
- all blueprint prerequisites must already exist locally as owned module blueprint IDs
- enough local inventory must exist for all required inputs

Starting construction currently does this:

- spends local inventory immediately
- sets the fabricator status to `active`
- stores a `constructionJob` in the fabricator module runtime attributes

Canceling construction currently does this:

- clears the local job
- sets the fabricator status back to `idle`
- does not refund materials

Tick completion currently does this:

- decrements `remainingTicks`
- creates the output module when the remaining ticks hit `0`
- clears the job
- returns the fabricator to `idle`

## Power And Solar Rules In The Current Implementation

Power draw:

- each module may define `runtimeAttributes.powerDrawKw`
- if it is numeric, that number is used
- if it is an object, the value for the current runtime `status` is used
- otherwise power draw is treated as `0`

Battery drain:

- the first module with `power-storage` and numeric `currentEnergyKwh` is the drain target
- requested energy is total kW times ticks divided by `3600`
- battery energy is clamped at `0`
- shortfall is tracked but module statuses are not auto-changed

Solar charging:

- only online solar modules count
- only the first online battery with storage fields can be charged
- irradiance is fetched from Kepler
- if no online solar module, no online battery, or no irradiance is available, charging does not occur
- current formula in code:
  `generatedKwh = totalGenerationKw * (irradiance.wPerM2 / 900) * 0.5 * (tickCount / 3600)`

## Legacy Objects Still Present

The local state file still includes older lab data:

- `batteryBanks`
- `solarPanels`
- `rovers`

These are separate from the newer Kepler-backed `modules` system.

If a future cleanup lab wants a narrower CLI, the current `habitat.json` may need migration or pruning rather than assuming only module-based state exists.

## Current Live Snapshot

This reflects the current checked-out local state in `habitat.json` at the time this handoff file was written.

Registration:

- display name: `George's Shack`
- habitat slug: `george-s-shack-bd09e90f`
- remote status: `registered`
- catalog version: `kepler-442b-v1`

Current local modules:

- `command_module_1`
- `life_support_1`
- `basic_battery_1`
- `supply_cache_1`
- `workshop_fabricator_1`
- `basic_suitport_1`

Current notable state:

- battery is currently `online`
- battery current energy is about `498.9541666666639 kWh`
- simulation current tick is `262`
- there is an active construction job on `workshop_fabricator_1`
- active job blueprint is `small-solar-array`
- active job output module ID is `local_small_solar_array_bebd1d69_a8a6_4b6f_b4cb_19ddce027fb3`
- active job remaining ticks are `10616`

Current local inventory:

- `ferrite: 210`
- `silicate-glass: 105`
- `conductive-ore: 62`
- `basalt-composite: 160`
- `rare-catalyst: 10`

## Useful Verification Commands

Run from the repo root, usually in WSL:

```bash
bun test
bun run check
habitat --help
habitat status
habitat module list
habitat module status
habitat inventory list
habitat construction status
habitat solar status
habitat blueprint list
habitat resource list
```

## Good Starting Questions For The Next Codex Chat

If the next chat needs to continue this project, good prompts include:

- "Read `docs/habitat-cli-context.md` and tell me what the CLI currently does."
- "Inspect the current Habitat CLI tick simulation before changing code."
- "Review the current construction workflow and tell me what is local versus what comes from Kepler."
- "Given the current `habitat.json`, explain the live state before making changes."
- "Add one small feature without changing the current Kepler/local state boundary."

## Cautions

- This repo is stateful. `habitat.json` is real working data, not just fixture data.
- The live local state may drift after more commands run, especially construction ticks and battery energy.
- PowerShell can be awkward for this CLI setup; WSL has been the more reliable runtime in practice.
- `src/index.ts` still does a lot of orchestration and persistence work even though behavior has been split into focused helper modules.
