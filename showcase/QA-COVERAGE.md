# Showcase Test Coverage Matrix

This matrix tracks what testing exists for each demo and the Sales Dashboard starter hero across manual QA checklists, automated unit tests, Playwright E2E tests, aimock-backed deterministic tests, and CI automation.

**Legend:**

- PASS Covered -- tests exist and verify this demo
- WARN Partial -- some coverage exists but gaps remain
- FAIL None -- no tests exist for this demo
- STUB Needs aimock -- tests exist but require aimock fixtures that are missing or incomplete

## Demo Coverage

| Demo                         | Manual QA               | Vitest Unit | Playwright E2E (smoke)  | Playwright E2E (interaction) | Per-Package E2E                                  | Aimock Fixtures                                              | CI Auto                                             |
| ---------------------------- | ----------------------- | ----------- | ----------------------- | ---------------------------- | ------------------------------------------------ | ------------------------------------------------------------ | --------------------------------------------------- |
| **Agentic Chat**             | PASS 17 packages        | FAIL        | PASS load + suggestions | WARN suggestion click only   | PASS weather card, background change, multi-turn | WARN `background`, `weather` matches                         | WARN validate only (no Playwright in CI by default) |
| **Human in the Loop**        | PASS 17 packages        | FAIL        | PASS load + suggestions | WARN suggestion click only   | PASS step selector, approve/reject               | WARN `plan`/`steps`/`mars` matches (text only, no interrupt) | WARN validate only                                  |
| **Tool Rendering**           | PASS 17 packages        | FAIL        | PASS load + suggestions | WARN suggestion click only   | PASS WeatherCard with stats grid                 | WARN `weather` match (tool call)                             | WARN validate only                                  |
| **Gen UI (Tool-Based)**      | PASS 17 packages        | FAIL        | FAIL                    | FAIL                         | PASS sidebar, haiku card, pie/bar chart          | FAIL no haiku-specific fixture                               | WARN validate only                                  |
| **Gen UI (Agent)**           | PASS 17 packages        | FAIL        | FAIL                    | FAIL                         | PASS task progress tracker, progress bar         | FAIL no gen-ui-agent fixture                                 | WARN validate only                                  |
| **Shared State (Read)**      | PASS 17 packages        | FAIL        | FAIL                    | FAIL                         | PASS recipe card, sidebar, pipeline              | FAIL no shared-state fixture                                 | WARN validate only                                  |
| **Shared State (Write)**     | PASS 17 packages (stub) | FAIL        | FAIL                    | FAIL                         | PASS pipeline, deal CRUD, agent state writes     | FAIL no shared-state fixture                                 | WARN validate only                                  |
| **Shared State (Streaming)** | PASS 17 packages (stub) | FAIL        | FAIL                    | FAIL                         | PASS document editor, confirm/reject changes     | FAIL no streaming fixture                                    | WARN validate only                                  |
| **Sub-Agents**               | PASS 17 packages (stub) | FAIL        | FAIL                    | FAIL                         | PASS travel planner, agent indicators, sections  | FAIL no subagent fixture                                     | WARN validate only                                  |

## Starter Hero Coverage

| Feature                         | Manual QA | Vitest Unit                                                      | Playwright E2E (smoke)                  | Playwright E2E (interaction)                    | Aimock Fixtures                    | CI Auto                                     |
| ------------------------------- | --------- | ---------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------- | ---------------------------------- | ------------------------------------------- |
| **Sales Dashboard (page load)** | FAIL      | PASS generate-starters tests (17 starters exist, file structure) | PASS header, 4 renderer pills           | PASS pill switching, content verification       | WARN `sales`/`todo`/`deal` matches | WARN validate + aimock-e2e (manual trigger) |
| **Renderer Selector**           | FAIL      | FAIL                                                             | PASS 4 pills visible, default selection | PASS mutual exclusion, content changes per mode | FAIL                               | WARN validate only                          |
| **Tool-Based mode**             | FAIL      | FAIL                                                             | PASS pipeline heading, KPI cards        | PASS Add a deal, multiple deals, empty state    | WARN `sales`/`todo` matches        | WARN validate only                          |
| **A2UI Catalog mode**           | FAIL      | FAIL                                                             | PASS same pipeline content              | FAIL                                            | FAIL                               | WARN validate only                          |
| **json-render mode**            | FAIL      | FAIL                                                             | PASS fallback note + pipeline           | FAIL                                            | FAIL                               | WARN validate only                          |
| **HashBrown mode**              | FAIL      | FAIL                                                             | PASS pipeline content                   | FAIL                                            | FAIL                               | WARN validate only                          |

## Test Infrastructure Details

### Manual QA Checklists (`showcase/packages/*/qa/*.md`)

- 153 files across 17 packages (17 × 9 demos)
- All 17 packages have checklists for all 9 demos: agentic-chat, hitl-in-chat, tool-rendering, gen-ui-tool-based, gen-ui-agent, shared-state-read, shared-state-write, shared-state-streaming, subagents
- Authored across all packages: agentic-chat, hitl-in-chat, tool-rendering, gen-ui-tool-based, gen-ui-agent, shared-state-read. Stub-only across all 17 packages (not yet authored): shared-state-write, shared-state-streaming, subagents (3 demos × 17 packages = 51 stub files).

### Vitest Unit Tests (`showcase/scripts/__tests__/*.test.ts`)

- `generate-starters.test.ts` -- verifies all 17 starters generate correctly, file structure, Python import rewriting
- `starter-consistency.test.ts` -- validates starter consistency across packages
- `generate-registry.test.ts` -- registry generation
- `validate-constraints.test.ts` -- constraint validation
- `bundle-demo-content.test.ts` -- demo content bundling
- `create-integration.test.ts` -- integration creation
- **Gap:** No unit tests for individual demo component logic

### Playwright E2E -- Shared (`showcase/scripts/__tests__/e2e/`)

- `starter-e2e.spec.ts` -- Sales Dashboard starter (15 tests: pills, modes, content switching, add deals)
- `demo-e2e.spec.ts` -- agentic-chat, hitl-in-chat, tool-rendering only (9 tests: load, suggestions, click)
- `screenshots.spec.ts` -- screenshot capture
- **Gap:** No shared E2E tests for gen-ui-tool-based, gen-ui-agent, shared-state-\*, subagents

### Playwright E2E -- Per-Package (`showcase/packages/*/tests/e2e/`)

- Every one of the 17 packages ships 9 per-demo spec files (agentic-chat, hitl-in-chat, tool-rendering, gen-ui-tool-based, gen-ui-agent, shared-state-read, shared-state-write, shared-state-streaming, subagents).
- `langgraph-python` additionally ships a 10th spec (`renderer-selector.spec.ts`) covering the Sales Dashboard renderer-selector flow; no other package has this spec.
- Tests require a running dev server and (for interaction tests) an agent backend or aimock, and are **not** wired into default CI — they run on demand locally or via the manual `test_e2e-showcase-on-demand.yml` trigger.
- **Gap:** The renderer-selector per-package coverage is langgraph-python-only; replicating it to at least one TypeScript package would verify cross-framework parity.

### Aimock Fixtures (`showcase/aimock/`)

- `feature-parity.json` -- 35 fixture entries covering: weather, charts, meetings, sales, flights, theme, background, plans, greetings
- `smoke.json` -- minimal smoke test fixtures
- **Gap:** No fixtures for haiku generation, recipe state, document streaming, travel planning, or interrupt/HITL flows

### CI Workflows (`.github/workflows/showcase_*.yml`)

- `showcase_validate.yml` -- runs `npx vitest run` on PR (unit tests only)
- `test_e2e-showcase-on-demand.yml` -- runs aimock-backed Playwright E2E, **manual trigger only** (`/test-aimock` comment or workflow_dispatch)
- `showcase_drift-detection.yml` -- template drift detection
- `showcase_template-drift.yml` -- template synchronization
- `showcase_deploy.yml` -- deployment pipeline
- **Gap:** No automatic Playwright E2E in CI on every PR; aimock E2E requires manual trigger

## Recommended Next Steps

1. **Add aimock fixtures** for gen-ui-tool-based (haiku), gen-ui-agent (task steps), shared-state (recipe/deals/document), subagents (travel), and HITL (interrupt with steps)
2. **Add shared E2E tests** in `demo-e2e.spec.ts` for the 6 demos currently missing (gen-ui-tool-based, gen-ui-agent, shared-state-read, shared-state-write, shared-state-streaming, subagents)
3. **Enable automatic Playwright E2E in CI** -- run at least smoke tests on every PR
4. **Add manual QA checklists** for the Sales Dashboard starter hero
5. **Replicate per-package E2E tests** to at least one TypeScript package (e.g. langgraph-typescript) to verify cross-framework parity
