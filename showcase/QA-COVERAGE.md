# Showcase Test Coverage Matrix

This matrix tracks what testing exists for each demo and the Sales Dashboard starter hero across manual QA checklists, automated unit tests, Playwright E2E tests, aimock-backed deterministic tests, and CI automation.

**Legend:**

- ✅ Covered -- tests exist and verify this demo
- ⚠️ Partial -- some coverage exists but gaps remain
- ❌ None -- no tests exist for this demo
- 🔧 Needs aimock -- tests exist but require aimock fixtures that are missing or incomplete

## Demo Coverage

| Demo                         | Manual QA                       | Vitest Unit | Playwright E2E (smoke) | Playwright E2E (interaction) | Per-Package E2E                                | Aimock Fixtures                                            | CI Auto                                           |
| ---------------------------- | ------------------------------- | ----------- | ---------------------- | ---------------------------- | ---------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------- |
| **Agentic Chat**             | ✅ 17 packages                  | ❌          | ✅ load + suggestions  | ⚠️ suggestion click only     | ✅ weather card, background change, multi-turn | ⚠️ `background`, `weather` matches                         | ⚠️ validate only (no Playwright in CI by default) |
| **Human in the Loop**        | ✅ 17 packages                  | ❌          | ✅ load + suggestions  | ⚠️ suggestion click only     | ✅ step selector, approve/reject               | ⚠️ `plan`/`steps`/`mars` matches (text only, no interrupt) | ⚠️ validate only                                  |
| **Tool Rendering**           | ✅ 17 packages                  | ❌          | ✅ load + suggestions  | ⚠️ suggestion click only     | ✅ WeatherCard with stats grid                 | ⚠️ `weather` match (tool call)                             | ⚠️ validate only                                  |
| **Gen UI (Tool-Based)**      | ✅ 17 packages                  | ❌          | ❌                     | ❌                           | ✅ sidebar, haiku card, pie/bar chart          | ❌ no haiku-specific fixture                               | ⚠️ validate only                                  |
| **Gen UI (Agent)**           | ✅ 1 package (langgraph-python) | ❌          | ❌                     | ❌                           | ✅ task progress tracker, progress bar         | ❌ no gen-ui-agent fixture                                 | ⚠️ validate only                                  |
| **Shared State (Read)**      | ✅ 1 package (langgraph-python) | ❌          | ❌                     | ❌                           | ✅ recipe card, sidebar, pipeline              | ❌ no shared-state fixture                                 | ⚠️ validate only                                  |
| **Shared State (Write)**     | ✅ 1 package (langgraph-python) | ❌          | ❌                     | ❌                           | ✅ pipeline, deal CRUD, agent state writes     | ❌ no shared-state fixture                                 | ⚠️ validate only                                  |
| **Shared State (Streaming)** | ✅ 1 package (langgraph-python) | ❌          | ❌                     | ❌                           | ✅ document editor, confirm/reject changes     | ❌ no streaming fixture                                    | ⚠️ validate only                                  |
| **Sub-Agents**               | ✅ 1 package (langgraph-python) | ❌          | ❌                     | ❌                           | ✅ travel planner, agent indicators, sections  | ❌ no subagent fixture                                     | ⚠️ validate only                                  |

## Starter Hero Coverage

| Feature                         | Manual QA | Vitest Unit                                                    | Playwright E2E (smoke)                | Playwright E2E (interaction)                  | Aimock Fixtures                  | CI Auto                                   |
| ------------------------------- | --------- | -------------------------------------------------------------- | ------------------------------------- | --------------------------------------------- | -------------------------------- | ----------------------------------------- |
| **Sales Dashboard (page load)** | ❌        | ✅ generate-starters tests (17 starters exist, file structure) | ✅ header, 4 renderer pills           | ✅ pill switching, content verification       | ⚠️ `sales`/`todo`/`deal` matches | ⚠️ validate + aimock-e2e (manual trigger) |
| **Renderer Selector**           | ❌        | ❌                                                             | ✅ 4 pills visible, default selection | ✅ mutual exclusion, content changes per mode | ❌                               | ⚠️ validate only                          |
| **Tool-Based mode**             | ❌        | ❌                                                             | ✅ pipeline heading, KPI cards        | ✅ Add a deal, multiple deals, empty state    | ⚠️ `sales`/`todo` matches        | ⚠️ validate only                          |
| **A2UI Catalog mode**           | ❌        | ❌                                                             | ✅ same pipeline content              | ❌                                            | ❌                               | ⚠️ validate only                          |
| **json-render mode**            | ❌        | ❌                                                             | ✅ fallback note + pipeline           | ❌                                            | ❌                               | ⚠️ validate only                          |
| **HashBrown mode**              | ❌        | ❌                                                             | ✅ pipeline content                   | ❌                                            | ❌                               | ⚠️ validate only                          |

## Test Infrastructure Details

### Manual QA Checklists (`showcase/packages/*/qa/*.md`)

- 73 files across 17 packages
- All 17 packages have checklists for: agentic-chat, hitl, tool-rendering, gen-ui-tool-based
- Only langgraph-python has checklists for: gen-ui-agent, shared-state-read, shared-state-write, shared-state-streaming, subagents

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
- `demo-e2e.spec.ts` -- agentic-chat, hitl, tool-rendering only (9 tests: load, suggestions, click)
- `screenshots.spec.ts` -- screenshot capture
- **Gap:** No shared E2E tests for gen-ui-tool-based, gen-ui-agent, shared-state-\*, subagents

### Playwright E2E -- Per-Package (`showcase/packages/langgraph-python/tests/e2e/`)

- 10 spec files covering all 9 demos + renderer-selector
- Tests require a running dev server and (for interaction tests) an agent backend or aimock
- **Gap:** These tests only exist for langgraph-python, not other 16 packages

### Aimock Fixtures (`showcase/aimock/`)

- `feature-parity.json` -- 35 fixture entries covering: weather, charts, meetings, sales, flights, theme, background, plans, greetings
- `smoke.json` -- minimal smoke test fixtures
- **Gap:** No fixtures for haiku generation, recipe state, document streaming, travel planning, or interrupt/HITL flows

### CI Workflows (`.github/workflows/showcase_*.yml`)

- `showcase_validate.yml` -- runs `npx vitest run` on PR (unit tests only)
- `showcase_aimock-e2e.yml` -- runs aimock-backed Playwright E2E, **manual trigger only** (`/test-aimock` comment or workflow_dispatch)
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
