# Showcase Testing

Tagline: `bin/showcase test` reference, cell red→green SOP, per-demo coverage
matrix, and CI gating matrix.

Three concerns live here:

1. **Cell red→green SOP** and `bin/showcase test` CLI reference — how to run the
   harness locally and how to drive a cell from red to green.
2. **Per-Demo Coverage Matrix** — what test surface exists for each demo across
   manual QA, unit, E2E, and aimock.
3. **CI gating matrix** — which CI workflows fire on which triggers and whether
   they gate merges.

Operational gotchas (aimock fixture caching, `--isolate` slot collisions, etc.)
live in [`GOTCHAS.md`](./GOTCHAS.md). Per-failure-mode debugging strategies and
production-side ops (probe triggering, Railway log access, isolated stack
cleanup) live in [`DEBUGGING.md`](./DEBUGGING.md).

## `bin/showcase test` invocation semantics

`--d5` / `--d6` route through the production-equivalent control-plane pipeline
(producer → queue → worker, same as Railway). `--direct` switches to a legacy
in-process driver (bypasses control-plane).

| Invocation                  | Family            | Pipeline      | Per-demo scoping (`:demo`)           |
| --------------------------- | ----------------- | ------------- | ------------------------------------ |
| `--d5` (no `:demo`)         | d5 representative | control-plane | hardcoded `agentic-chat`             |
| `--d5 :demo`                | d5 single demo    | control-plane | honored (post-A18)                   |
| `--d5 --direct`             | d5 family         | in-process    | honored via `buildDeepInputs`        |
| `--d6` (no `:demo`)         | d6 full sweep     | control-plane | full demo list, aggregate validation |
| `--d6 :demo`                | d6 single demo    | control-plane | honored (post-A18)                   |
| `--d6 --direct`             | d6 family         | in-process    | honored via `buildFullInputs`        |
| `--direct` (no `--d5/--d6`) | d5+d6 default     | in-process    | honored                              |

**Use control-plane (no `--direct`) for production-equivalent testing.** It
exercises the same producer→queue→worker pipeline Railway uses, so local
results are apples-to-apples with staging. `--direct` is opt-out legacy:
useful for fast in-process debugging when you don't need the queue.

`--isolate` (post-A21+A21b) scopes the rebuild to the target slug — infra
services (aimock, pocketbase, dashboard, harness, harness-pool-worker) reuse
cached images from the local Docker store. Cold-build is ~30s–2 min per slug
instead of 10+ min full-stack rebuild.

### Session-stack discipline / Cleanup after isolated runs

This governs every `--isolate`/`--keep` invocation below. The leak it prevents:
agents minting a _new_ named kept stack per cell (`cvtest2`, `greenproof`,
`gp1`..`gp10`, `showcase-iso2/4`, …) and never tearing them down — each one
holds a slot and burns offset ports until the host fills up.

1. **One stack per session, reused.** At the start of a debugging/testing
   session, choose ONE stable isolate name and use
   `--isolate <session-name> --keep` for ALL tests in that session. Every
   subsequent test in the same session MUST reuse ONE `--isolate <session-name>`
   — never mint a new named stack per individual cell/feature/pill (that is what
   leaks named stacks). Derive the session name from the primary slug under test
   so reuse is unambiguous, e.g. `--isolate <slug>-session`. Each `--keep` re-run
   with the same name pre-cleans (`docker compose -p <name> down`) and recreates
   that ONE stack, so you never pile up N named stacks. (Re-running the same name
   while the prior kept stack is still live fails loudly with a duplicate-name
   guard — another reason to keep to ONE name and tear down between fresh
   builds.)

2. **`--keep` is for intra-session reuse only, never a license to leak.** It
   exists so a session-long stack survives between tests; if you pass `--keep`,
   you OWN teardown at session end.

3. **Tear down at session end.** When the session's work is done — and as part
   of the Done criteria — tear down every stack the session created and release
   its slot, using the survival-notice teardown command (printed at exit):

   ```sh
   docker compose -p <name> down --remove-orphans --volumes && rm -rf <run-dir> <slot-dir>
   ```

   `bin/showcase down` does NOT tear down an isolated stack — it only stops the
   default (non-isolated) `showcase-*` project. Use the explicit
   `docker compose -p <name> down …` from the notice (run-dir and slot-dir are
   the real paths it prints). Bare `--isolate` (no `--keep`) auto-cleans on exit
   and frees its slot — prefer it for one-off tests that don't need to persist
   across the session.

The teardown mechanics, the RUNNING-only slot protection, and the scratch/slot
paths are documented once in [`DEBUGGING.md` → Cleanup](./DEBUGGING.md#cleanup);
this section owns the discipline (reuse ONE, tear down at end).

## SOP: turning a cell red → green

1. **Run the harness LOCALLY FIRST.** Capture the RED log via the production-equivalent
   path BEFORE any code change:

   ```
   bin/showcase test <slug>:<demo> --d5 --isolate
   ```

   No theory, no "should work" — observe the actual failure.

2. **One change. Verify GREEN locally on the same probe.** Re-run the same invocation;
   it must go green. Iterate if not. Don't commit on red.

3. **LGP regression check every time.** Gold-standard cell must stay green:

   ```
   bin/showcase test langgraph-python:tool-rendering-custom-catchall --d5 --isolate
   ```

4. **Diagnose by failure mode** (use the aimock `/journal` endpoint + `docker logs
showcase-iso<N>-aimock` + DOM/probe text):
   - Backend doesn't loop after `tool_result` → backend fix (add tool handler, fix
     agentId routing). See `crewai-crews` for the canonical example.
   - `toolCallId`-gated narration fixture doesn't match → backend rewrites IDs
     (Anthropic `toolu_*`, TanStack `fc-*`). Fix: swap `toolCallId` discriminator
     for `turnIndex` (or `hasToolResult` / `sequenceIndex`) — backend-id-invariant.
     See `built-in-agent` and `claude-sdk-typescript` for canonical match-key tunes.
   - No fixture entry matches the probe's `userMessage` → add the entry following
     the existing match-shape conventions.
   - Probe scan returns false despite phrase visibly in DOM → harness/probe bug.

5. **Layer boundaries:**
   - **Fixtures: per-integration freedom.** Do NOT modify `response.content` (canonical
     narration is fixture-author truth — the d5 probe asserts on it; a real LLM won't
     reliably emit the verbatim phrase). Tune `match` keys instead.
   - **Backends: minimal.** Faithfully echo aimock prescriptions where possible;
     close the tool-loop with a second LLM call after `tool_result`. Don't expand
     backend logic when a fixture match-key change suffices.
   - **Tests: identical** across integrations (the d5 probe is shared).
   - **Frontends: near-identical** — don't touch in cell-fix scope.
   - **LGP is gold standard.** Diff against `langgraph-python`'s fixture/backend
     pattern, not the sibling-of-the-day.

6. **aimock matcher semantics** (for `/v1/responses` after `responsesInputToMessages`
   transform; identical to `/v1/chat/completions`):
   | Match key | Semantics |
   |------------------|------------------------------------------------------------------------|
   | `userMessage` | substring on the last `role:"user"` message |
   | `toolCallId` | strict equality vs last `role:"tool"` `tool_call_id` (FRAGILE — backend ID-rewrite breaks this) |
   | `hasToolResult` | boolean: any `role:"tool"` message present |
   | `turnIndex` | integer: count of `role:"assistant"` messages |
   | `context` | equality vs `x-aimock-context` header |

   First-match-wins. Order entries specific-before-generic.

7. **aimock caches fixtures at container startup.** Editing a fixture in a live
   stack requires `docker restart showcase-iso<N>-aimock` to reload. Fresh
   `--isolate` slots cold-start aimock from the volume mount, so the first
   post-edit run picks up the change automatically; warm-slot reuse will not.

8. **`--isolate` slot pinning and conflict detection.** Pin a specific slot with `SHOWCASE_ISO_SLOT=<N>` (1-45; slot 0 is reserved for the base stack), or use the equivalent CLI sugar `--isolate=<N>` — the picker uses exactly that slot or fails loudly. The auto-picker now port-probes every candidate via `lsof` before committing, so foreign-Docker (`ag2mm-*`) and host-process (macOS AirPlay on 5000) conflicts are detected pre-`docker compose up`. Run `bin/showcase slots` to inspect all 46 slots across DIR / PID / LIVE / PORTS / OFFSET (and PROJECT) — same code path the picker uses. The `LIVE` column reports `live` / `stale` / `inconclusive` and folds the live-pid and live-containers checks into one axis.

9. **Cell-color flip claims MUST be empirically value-tested via the
   production-equivalent control-plane path** on ≥3 candidate cells before merge.
   No "should flip N." Use:

   ```
   bin/showcase test <slug>:<feature> --d6 --isolate
   ```

   (or `--d5 --isolate` for single-pill e2e). DO NOT use `--direct` for
   value-test — it bypasses the queue/worker pipeline staging actually runs and
   has misled investigations in the past.

   Pick `<N>` by first running `bin/showcase slots` (or `bin/showcase slots --free --brief` for a machine-readable list) and choosing a row whose `DIR` is `absent`, `LIVE` is not `live`, and `PORTS` is not `held`, then pin the slot via either form (both are equivalent):

   ```
   SHOWCASE_ISO_SLOT=<N> bin/showcase test <slug>:<feature> --d6 --isolate
   # — or, equivalently —
   bin/showcase test <slug>:<feature> --d6 --isolate=<N>
   ```

10. **No fixture rewrite from real-LLM record/replay.** The canonical-phrase probe
    is anti-record/replay-against-real-LLM by construction: a real LLM won't emit
    the verbatim assertion phrase. Fixture content is authored truth; tune the
    `match` keys to fire on the right turn.

## Per-Demo Coverage Matrix

Tagline: what test surface exists per demo. PASS=covered, WARN=partial, FAIL=none, STUB=needs aimock fixture.

### Demo Coverage

| Demo                         | Manual QA               | Vitest Unit | Playwright E2E (smoke)  | Playwright E2E (interaction) | Per-Package E2E                                  | Aimock Fixtures                                              | CI Auto                                             |
| ---------------------------- | ----------------------- | ----------- | ----------------------- | ---------------------------- | ------------------------------------------------ | ------------------------------------------------------------ | --------------------------------------------------- |
| **Agentic Chat**             | PASS 19 packages        | FAIL        | PASS load + suggestions | WARN suggestion click only   | PASS weather card, background change, multi-turn | WARN `background`, `weather` matches                         | WARN validate only (no Playwright in CI by default) |
| **Human in the Loop**        | PASS 19 packages        | FAIL        | PASS load + suggestions | WARN suggestion click only   | PASS step selector, approve/reject               | WARN `plan`/`steps`/`mars` matches (text only, no interrupt) | WARN validate only                                  |
| **Tool Rendering**           | PASS 19 packages        | FAIL        | PASS load + suggestions | WARN suggestion click only   | PASS WeatherCard with stats grid                 | WARN `weather` match (tool call)                             | WARN validate only                                  |
| **Gen UI (Tool-Based)**      | PASS 19 packages        | FAIL        | FAIL                    | FAIL                         | PASS sidebar, haiku card, pie/bar chart          | FAIL no haiku-specific fixture                               | WARN validate only                                  |
| **Gen UI (Agent)**           | PASS 19 packages        | FAIL        | FAIL                    | FAIL                         | PASS task progress tracker, progress bar         | FAIL no gen-ui-agent fixture                                 | WARN validate only                                  |
| **Shared State (Read)**      | PASS 19 packages        | FAIL        | FAIL                    | FAIL                         | PASS recipe card, sidebar, pipeline              | FAIL no shared-state fixture                                 | WARN validate only                                  |
| **Shared State (Write)**     | PASS 19 packages (stub) | FAIL        | FAIL                    | FAIL                         | PASS pipeline, deal CRUD, agent state writes     | FAIL no shared-state fixture                                 | WARN validate only                                  |
| **Shared State (Streaming)** | PASS 19 packages (stub) | FAIL        | FAIL                    | FAIL                         | PASS document editor, confirm/reject changes     | FAIL no streaming fixture                                    | WARN validate only                                  |
| **Sub-Agents**               | PASS 19 packages (stub) | FAIL        | FAIL                    | FAIL                         | PASS travel planner, agent indicators, sections  | FAIL no subagent fixture                                     | WARN validate only                                  |

> The Manual-QA column counts the **19 integration packages that ship a `qa/`
> directory** — `ms-agent-harness-dotnet` ships no manual-QA checklists, so it
> is excluded from these counts (the package count of 20 in Test Infrastructure
> Locations still reflects all integration packages).

### Starter Hero Coverage

| Feature                         | Manual QA | Vitest Unit                                       | Playwright E2E (smoke)                  | Playwright E2E (interaction)                    | Aimock Fixtures                    | CI Auto                                     |
| ------------------------------- | --------- | ------------------------------------------------- | --------------------------------------- | ----------------------------------------------- | ---------------------------------- | ------------------------------------------- |
| **Sales Dashboard (page load)** | FAIL      | PASS extract-starter tests (on-demand extraction) | PASS header, 4 renderer pills           | PASS pill switching, content verification       | WARN `sales`/`todo`/`deal` matches | WARN validate + aimock-e2e (manual trigger) |
| **Renderer Selector**           | FAIL      | FAIL                                              | PASS 4 pills visible, default selection | PASS mutual exclusion, content changes per mode | FAIL                               | WARN validate only                          |
| **Tool-Based mode**             | FAIL      | FAIL                                              | PASS pipeline heading, KPI cards        | PASS Add a deal, multiple deals, empty state    | WARN `sales`/`todo` matches        | WARN validate only                          |
| **A2UI Catalog mode**           | FAIL      | FAIL                                              | PASS same pipeline content              | FAIL                                            | FAIL                               | WARN validate only                          |
| **json-render mode**            | FAIL      | FAIL                                              | PASS fallback note + pipeline           | FAIL                                            | FAIL                               | WARN validate only                          |
| **HashBrown mode**              | FAIL      | FAIL                                              | PASS pipeline content                   | FAIL                                            | FAIL                               | WARN validate only                          |

### Probe Depth Coverage

| Depth | Probe Name       | Cadence    | What "Green" Means                                |
| ----- | ---------------- | ---------- | ------------------------------------------------- |
| D5    | e2e-demos        | hourly :10 | All per-integration smoke probes pass             |
| D6    | d6-all-pills-e2e | hourly :40 | All demo cells pass across every integration pill |

### Test Infrastructure Locations

- **Manual QA**: `showcase/integrations/*/qa/*.md` (~498 files across 20 integration packages; per-package counts vary widely, e.g. `langgraph-python` 39, `langgraph-fastapi` 10).
- **Vitest unit**: `showcase/scripts/__tests__/*.test.ts` — registry/constraint/bundle/integration generators.
- **Shared E2E**: `showcase/scripts/__tests__/e2e/` — `starter-e2e.spec.ts`, `demo-e2e.spec.ts`, `screenshots.spec.ts`.
- **Per-package E2E**: `showcase/integrations/*/tests/e2e/` — ~33–41 demo/feature specs per package (e.g. `langgraph-python` 38; `ms-agent-harness-dotnet` only 9).
- **Aimock fixtures**: `showcase/aimock/` — `shared/common.json`, `shared/smoke.json`, `d4/<slug>/`, `d6/<slug>/`.
- **CI**: `.github/workflows/showcase_*.yml` (see Test-Gating Matrix below).

### Known coverage gaps

1. No aimock fixtures for haiku, recipe/deals/document state, travel planning, HITL interrupt.
2. No shared E2E for gen-ui-tool-based, gen-ui-agent, shared-state-\*, subagents.
3. No automatic Playwright E2E in CI on every PR; aimock E2E requires `/test-aimock` comment.
4. No Sales Dashboard starter manual QA checklists.
5. No per-package renderer-selector E2E spec — renderer-selector coverage comes from the shared starter E2E (`showcase/scripts/__tests__/e2e/starter-e2e.spec.ts`) against the shared starter-template component (`showcase/shared/starter-template/components/renderers/renderer-selector.tsx`).

## Test-Gating Matrix

This matrix documents which CI workflows fire on which triggers, what they test, and whether they gate merges.

Scope: all testing-related workflows (unit, integration, e2e, smoke) across the monorepo. Data read directly from `.github/workflows/*.yml` on the current branch.

## Matrix

| Workflow file                                       | Name (CI UI)                      | Trigger                                                                                     | Path filter                                                                                                                          | Required? | What it tests                                                                                    |
| --------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------ |
| `.github/workflows/test_unit.yml`                   | test / unit                       | push (main), pull_request (main), workflow_dispatch                                         | paths-ignore: `README.md`, `examples/**`, `showcase/**`, `sdk-python/**`                                                             | No        | Vitest unit suite across Node 20/22/24 for all TS packages                                       |
| `.github/workflows/test_unit-python-sdk.yml`        | test / unit / python-sdk          | push (main), pull_request (main)                                                            | `sdk-python/**`, this workflow                                                                                                       | No        | pytest against `sdk-python/` across a Python 3.10–3.14 matrix + Poetry                           |
| `.github/workflows/test_integration-runtime.yml`    | test / integration / runtime      | push (main), pull_request (main), workflow_dispatch                                         | `packages/runtime/**`, this workflow                                                                                                 | No        | Runtime server integration tests (Node, possibly others)                                         |
| `.github/workflows/test_integration-docs.yml`       | test / integration / docs         | push (main), pull_request                                                                   | `showcase/shell-docs/src/content/**`, docs validation scripts                                                                        | No        | Extracts code blocks from shell-docs, runs them against aimock (model-name + doc-test)           |
| `.github/workflows/test_e2e-dojo.yml`               | test / e2e / dojo                 | push (main), pull_request (main), workflow_dispatch                                         | `packages/**`, `sdk-python/**`, this workflow                                                                                        | No        | ag-ui dojo end-to-end matrix on Depot runners                                                    |
| `.github/workflows/test_e2e-legacy-v1.yml`          | test / e2e / legacy-v1            | push (main), pull_request (main), workflow_dispatch                                         | `examples/**`, this workflow                                                                                                         | No        | Legacy v1.x examples (form-filling, travel, research-canvas, chat-with-your-data, state-machine) |
| `.github/workflows/showcase_validate.yml`           | Showcase: Validate                | push (main), pull_request                                                                   | `showcase/**`, `examples/integrations/**`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, validate + deploy workflow files | No        | Build-pipeline Vitest + manifest/registry validation + shell build                               |
| `.github/workflows/test_e2e-showcase-on-demand.yml` | test / e2e / showcase / on-demand | issue_comment (`/test-aimock`), workflow_dispatch                                           | n/a (comment-gated)                                                                                                                  | No        | aimock-backed Playwright E2E on demand per-package                                               |
| `.github/workflows/test_smoke-starter.yml`          | test / smoke / starter            | schedule (`0 */6 * * *`), workflow_run (publish / release), pull_request, workflow_dispatch | `examples/integrations/**`, this workflow                                                                                            | No        | Docker-compose smoke for 12 starter integrations (build + curl)                                  |

## Which tests run on a typical PR?

- `packages/**` (runtime/SDK): `test / unit`, `test / integration`, `test / e2e / dojo`, `static / quality`, `static / check binaries`, plus `static / danger` if `packages/sdk-js/src/langgraph.ts` is touched.
- `sdk-python/**`: `test / unit / python-sdk`, `test / e2e / dojo`, `static / quality`, `static / check binaries`, plus `static / danger` if `sdk-python/copilotkit/langgraph_agent.py` is touched. `test / unit` does NOT fire (paths-ignore excludes `sdk-python/**`).
- `showcase/**`: `Showcase: Validate`, `static / quality`, `static / check binaries`. `test / unit` does NOT fire (paths-ignore excludes `showcase/**`). No Playwright E2E runs automatically -- comment `/test-aimock` on the PR to trigger `test / e2e / showcase / on-demand`.
- `examples/**` (legacy v1.x): `test / e2e / legacy-v1`, `static / check binaries`. `test / unit` is excluded via paths-ignore.
- `examples/integrations/**` (starters): `test / smoke / starter` (Docker), `Showcase: Validate` (for fixtures only), `static / check binaries`.
- `showcase/shell-docs/src/content/**`: `test / integration / docs`, `Showcase: Validate`, and showcase build checks.
- `.github/workflows/**`: each workflow that lists its own path in its trigger runs (most do). No single "workflows changed" catch-all.

## Required status checks

None of the workflows above are enforced as required status checks. The active `PROTECT_OUR_MAIN` ruleset on `main` requires zero status contexts -- merges are gated only by review approval, not by CI outcome.

Classic branch protection on `main` is fully disabled — `GET .../branches/main/protection` and `.../required_status_checks/contexts` both return HTTP 404 ("Branch protection has been disabled on this repository"), so there is no `required_status_checks.contexts` array to read from the live API. If you see a CI workflow marked as "required" in an older doc or script, treat that as ghost data: nothing in GitHub's current enforcement path consumes it.

Practical consequence: a red CI run does not block merge. Reviewers must eyeball `gh pr checks` before approving.

## Footnotes

- `test / unit` matrix is Node 20/22/24; the other workflows pin a single Node version each (22 most common).
- Ten workflows run on Depot runners. Nine use `depot-ubuntu-24.04-4`: `test / e2e / dojo`, `test / unit`, `test / e2e / legacy-v1`, `test / integration / docs`, `test / integration / runtime`, `test / unit / python-sdk`, `Showcase: Validate`, `Showcase: Build & Push`, and `Showcase: Build Check (PR)`. The tenth, `showcase / eval`, runs on the larger `depot-ubuntu-24.04-16`.
- `test / smoke / starter` runs every 6h and validates Docker-build integrity of `examples/integrations/`.
- `workflow_run` triggers fire after another workflow completes -- they do not gate the triggering PR, they run post-merge.
