# Crew Exploration Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add starter human persistence, EVA exploration, local collection flow, and persisted alerts to the Habitat CLI and local Habitat API while preserving the existing backend-owned SQLite and Kepler boundary.

**Architecture:** Keep the CLI as a formatter and local API client, keep Hono as the only owner of SQLite and Kepler calls, and add focused modules for humans, EVA state, collection rules, and alerts. Registration remains the source of truth for starter modules, starter humans, and alert contracts, while the backend enforces local movement, EVA, and collection rules before calling Kepler.

**Tech Stack:** Bun, TypeScript, Hono, bun:sqlite, Commander, existing Habitat CLI formatter and tests

## Global Constraints

- SQLite is only read and written by the backend.
- The CLI may keep command-level validation and formatting, but it must not call Kepler directly.
- Kepler owns shared planet truth: scan probabilities, solar irradiance, and authoritative remaining tile quantity.
- The Habitat backend owns local state: humans, module locations, active explorer state, carried resources, returned inventory, and alerts.
- Use canonical local endpoints only; do not add duplicate `/api/...` aliases.
- Preserve beginner-friendly CLI output and `--json` behavior where it already exists.

---

### Task 1: Extend local state types for registration humans, contracts, EVA, and alerts

**Files:**
- Modify: `src/local-state.ts`
- Modify: `src/habitat-api.ts`
- Test: `src/habitat-api.test.ts`

**Interfaces:**
- Consumes: existing `HabitatRegistrationRecord`, `LocalState`, `RegistrationCreateResponse`, `RegistrationStatusResponse`
- Produces: `StarterHumanRecord`, `AlertContractRecord`, `LocalEvaState`, `AlertRecord`, expanded `HabitatRegistrationRecord`

- [ ] Add shared state types for starter humans, alert contract storage, EVA state, carried resources, and persisted alerts.
- [ ] Add failing API tests that expect registration hydration responses and stored state to support `starterHumans` and `contracts.alerts`.
- [ ] Implement the minimal type and response changes needed for those tests to pass.
- [ ] Run targeted tests for `src/habitat-api.test.ts`.

### Task 2: Persist starter humans transactionally during registration

**Files:**
- Modify: `src/local-state-storage.ts`
- Modify: `src/habitat-api.ts`
- Test: `src/habitat-api.test.ts`

**Interfaces:**
- Consumes: `StarterHumanRecord[]`, `HabitatRegistrationRecord`, SQLite `state_meta`
- Produces: registration persistence that writes starter modules and starter humans together

- [ ] Add failing tests that verify `POST /registration` persists both starter modules and two starter humans together.
- [ ] Add a failing test for rollback behavior when persistence fails after registration data is received.
- [ ] Implement transactional registration persistence in the backend using the existing SQLite store boundary.
- [ ] Re-run targeted registration tests until green.

### Task 3: Add human listing and movement backend support

**Files:**
- Create: `src/humans.ts`
- Modify: `src/habitat-api.ts`
- Modify: `src/local-state.ts`
- Test: `src/habitat-api.test.ts`

**Interfaces:**
- Consumes: `LocalState.humans`, `ModuleRecord`, crew capacity data from module runtime attributes
- Produces: `GET /humans`, `POST /humans/:humanId/move`, human lookup and module-capacity helpers

- [ ] Add failing backend tests for `GET /humans` and valid/invalid human moves.
- [ ] Add failing backend tests that reject moves to missing modules and full modules.
- [ ] Implement focused human helpers in `src/humans.ts` and wire the routes through Hono.
- [ ] Re-run targeted human API tests until green.

### Task 4: Prevent deletion of occupied modules

**Files:**
- Modify: `src/habitat-api.ts`
- Test: `src/habitat-api.test.ts`

**Interfaces:**
- Consumes: `findHumanOccupyingModule(state, moduleId)`
- Produces: `DELETE /modules/:moduleId` rejection when a human occupies the target module

- [ ] Add a failing backend test that deleting an occupied module is rejected with a helpful message.
- [ ] Implement the occupancy guard in the module delete route.
- [ ] Re-run targeted delete-route tests until green.

### Task 5: Add CLI human commands

**Files:**
- Modify: `src/habitat-api-client.ts`
- Modify: `src/index.ts`
- Modify: `src/cli-format.ts`
- Create: `src/habitat-api-client.test.ts` updates
- Test: `src/habitat-api-client.test.ts`

**Interfaces:**
- Consumes: `GET /humans`, `POST /humans/:humanId/move`
- Produces: `habitat human list`, `habitat human move <human-id> <module-id>`

- [ ] Add failing client tests for the new human routes.
- [ ] Add failing CLI-level tests or command wiring expectations for `human list` and `human move`.
- [ ] Implement client methods and CLI formatting/wiring with readable table output.
- [ ] Re-run targeted client tests until green.

### Task 6: Add EVA state and backend routes

**Files:**
- Create: `src/eva.ts`
- Modify: `src/habitat-api.ts`
- Modify: `src/local-state.ts`
- Test: `src/habitat-api.test.ts`

**Interfaces:**
- Consumes: humans, modules, suitport capability, current exploration state
- Produces: `GET /eva`, `POST /eva/deploy`, `POST /eva/move`, `POST /eva/dock`

- [ ] Add failing backend tests for deploy, single-step movement, invalid diagonal/jump movement, invalid dock away from origin, and status reads.
- [ ] Implement EVA state helpers in `src/eva.ts` with persisted coordinates, carrying capacity, and deployed human tracking.
- [ ] Wire the new Hono EVA routes and keep validation on the backend.
- [ ] Re-run targeted EVA tests until green.

### Task 7: Add CLI EVA commands

**Files:**
- Modify: `src/habitat-api-client.ts`
- Modify: `src/index.ts`
- Test: `src/habitat-api-client.test.ts`

**Interfaces:**
- Consumes: `GET /eva`, `POST /eva/deploy`, `POST /eva/move`, `POST /eva/dock`
- Produces: `habitat eva status`, `habitat eva deploy <human-id>`, `habitat eva move <x> <y>`, `habitat eva dock`

- [ ] Add failing client tests for EVA routes.
- [ ] Implement client methods and CLI command wiring with readable status output.
- [ ] Re-run targeted client tests until green.

### Task 8: Move scanning to the explorer position

**Files:**
- Modify: `src/habitat-api.ts`
- Modify: `src/habitat-api-client.ts`
- Modify: `src/index.ts`
- Modify: `src/scan.ts`
- Test: `src/habitat-api.test.ts`
- Test: `src/habitat-api-client.test.ts`

**Interfaces:**
- Consumes: `LocalEvaState.position`, `GET /scan?strength=...&radius=...`
- Produces: backend-owned scan origin validation, CLI scan command without `--x` or `--y`

- [ ] Add failing backend tests that require a deployed explorer and use saved coordinates for the Kepler scan request.
- [ ] Add failing client tests for the new scan query shape.
- [ ] Update scan wiring so the CLI only accepts strength/radius and the backend supplies origin and `habitatId`.
- [ ] Re-run targeted scan tests until green.

### Task 9: Add collection rules and Kepler collect proxy

**Files:**
- Create: `src/collection.ts`
- Modify: `src/habitat-api.ts`
- Modify: `src/local-state.ts`
- Test: `src/habitat-api.test.ts`

**Interfaces:**
- Consumes: deployed EVA state, carrying capacity, `POST /world/collect`
- Produces: `POST /collect`, carried resource updates after Kepler success only

- [ ] Add failing backend tests for successful collection, over-capacity rejection, no deployed human rejection, and no local mutation on Kepler failure.
- [ ] Implement collection rules in a focused module and wire the backend route through Kepler.
- [ ] Re-run targeted collection tests until green.

### Task 10: Add CLI collect command

**Files:**
- Modify: `src/habitat-api-client.ts`
- Modify: `src/index.ts`
- Test: `src/habitat-api-client.test.ts`

**Interfaces:**
- Consumes: `POST /collect`
- Produces: `habitat collect <quantity-kg>`

- [ ] Add a failing client test for the collect route.
- [ ] Implement the client method and CLI command output.
- [ ] Re-run targeted client tests until green.

### Task 11: Unload carried resources on dock transactionally

**Files:**
- Modify: `src/eva.ts`
- Modify: `src/habitat-api.ts`
- Modify: `src/local-state-storage.ts`
- Test: `src/habitat-api.test.ts`

**Interfaces:**
- Consumes: carried EVA resources, inventory state, suitport location
- Produces: transactional dock behavior that transfers inventory, clears EVA state, returns the human to the suitport

- [ ] Add failing backend tests for successful unload and full dock reset.
- [ ] Add a failing backend test that partial dock failure does not save partial state.
- [ ] Implement transactional dock persistence in the backend/store boundary.
- [ ] Re-run targeted dock tests until green.

### Task 12: Persist and manage alerts

**Files:**
- Create: `src/alerts.ts`
- Modify: `src/local-state.ts`
- Modify: `src/habitat-api.ts`
- Modify: `src/eva.ts`
- Modify: `src/collection.ts`
- Test: `src/habitat-api.test.ts`

**Interfaces:**
- Consumes: registration alert contract, EVA deployment events, collection outcomes, carrying-capacity state
- Produces: `GET /alerts`, `POST /alerts/:alertId/acknowledge`, deduplicated open/acknowledged/resolved alert lifecycle

- [ ] Add failing backend tests for alert creation, deduped occurrence count updates, acknowledge, and resolve.
- [ ] Implement focused alert helpers that follow the registration contract shape and lifecycle.
- [ ] Wire alert generation into EVA deploy/dock, capacity reached, and post-validation collect failure behavior.
- [ ] Re-run targeted alert tests until green.

### Task 13: Add CLI alert commands

**Files:**
- Modify: `src/habitat-api-client.ts`
- Modify: `src/index.ts`
- Test: `src/habitat-api-client.test.ts`

**Interfaces:**
- Consumes: `GET /alerts`, `POST /alerts/:alertId/acknowledge`
- Produces: `habitat alert list`, `habitat alert acknowledge <alert-id>`

- [ ] Add failing client tests for alert routes.
- [ ] Implement client methods and CLI command wiring.
- [ ] Re-run targeted client tests until green.

### Task 14: Full verification and cleanup

**Files:**
- Modify: tests as needed

**Interfaces:**
- Consumes: all tasks above
- Produces: passing repo checks and a working CLI flow

- [ ] Run `bun test` in WSL and fix any remaining failures.
- [ ] Run `bun run check` in WSL and fix any type errors.
- [ ] Run a manual CLI mission walkthrough in WSL against the local API and verify humans, EVA, scan, collect, dock, inventory, and alerts.
- [ ] Commit the finished lab work with a clear message after verification.
