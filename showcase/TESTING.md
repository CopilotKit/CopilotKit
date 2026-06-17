# Showcase Testing

Two concerns live here:

1. **Cell red→green SOP** and `bin/showcase test` CLI reference — how to run the
   harness locally and how to drive a cell from red to green. Start here for
   day-to-day debugging.
2. **CI gating matrix** — which CI workflows fire on which triggers and whether
   they gate merges. Skip to [Test-Gating Matrix](#test-gating-matrix) for that.

Operational gotchas (aimock fixture caching, `--isolate` slot collisions, etc.)
live in [`GOTCHAS.md`](./GOTCHAS.md). Per-framework debugging strategies live in
[`DEBUGGING.md`](./DEBUGGING.md). Production-side ops (probe triggering, Railway
log access, isolated stack cleanup) live in [`RUNBOOK.md`](./RUNBOOK.md).

## `bin/showcase test` invocation semantics

`--d5` / `--d6` route through the production-equivalent control-plane pipeline
(producer → queue → worker, same as Railway). `--direct` switches to a legacy
in-process driver (bypasses control-plane).

| Invocation                                    | Family            | Pipeline       | Per-demo scoping (`:demo`)                |
|-----------------------------------------------|-------------------|----------------|-------------------------------------------|
| `--d5` (no `:demo`)                           | d5 representative | control-plane  | hardcoded `agentic-chat`                  |
| `--d5 :demo`                                  | d5 single demo    | control-plane  | honored (post-A18)                        |
| `--d5 --direct`                               | d5 family         | in-process     | honored via `buildDeepInputs`             |
| `--d6` (no `:demo`)                           | d6 full sweep     | control-plane  | full demo list, aggregate validation      |
| `--d6 :demo`                                  | d6 single demo    | control-plane  | honored (post-A18)                        |
| `--d6 --direct`                               | d6 family         | in-process     | honored via `buildFullInputs`             |
| `--direct` (no `--d5/--d6`)                   | d5+d6 default     | in-process     | honored                                   |

**Use control-plane (no `--direct`) for production-equivalent testing.** It
exercises the same producer→queue→worker pipeline Railway uses, so local
results are apples-to-apples with staging. `--direct` is opt-out legacy:
useful for fast in-process debugging when you don't need the queue.

`--isolate` (post-A21+A21b) scopes the rebuild to the target slug — infra
services (aimock, pocketbase, dashboard, harness, harness-pool-worker) reuse
cached images from the local Docker store. Cold-build is ~30s–2 min per slug
instead of 10+ min full-stack rebuild.

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
   | Match key        | Semantics                                                              |
   |------------------|------------------------------------------------------------------------|
   | `userMessage`    | substring on the last `role:"user"` message                            |
   | `toolCallId`     | strict equality vs last `role:"tool"` `tool_call_id` (FRAGILE — backend ID-rewrite breaks this) |
   | `hasToolResult`  | boolean: any `role:"tool"` message present                             |
   | `turnIndex`      | integer: count of `role:"assistant"` messages                          |
   | `context`        | equality vs `x-aimock-context` header                                  |

   First-match-wins. Order entries specific-before-generic.

7. **aimock caches fixtures at container startup.** Editing a fixture in a live
   stack requires `docker restart showcase-iso<N>-aimock` to reload. Fresh
   `--isolate` slots cold-start aimock from the volume mount, so the first
   post-edit run picks up the change automatically; warm-slot reuse will not.

8. **`--isolate` slot collisions with foreign Docker projects.** The slot registry
   only knows about `showcase-*` compose projects. If a sibling project (e.g.,
   `ag2mm-*`) owns the same host ports for the auto-picked slot, health checks
   cross to the wrong containers and results misroute. Either pre-reserve the
   conflicting slot dirs in `~/.local/state/copilotkit/showcase/slots/` or tear
   down the foreign stack first.

9. **Cell-color flip claims MUST be empirically value-tested via the
   production-equivalent control-plane path** on ≥3 candidate cells before merge.
   No "should flip N." Use:
   ```
   bin/showcase test <slug>:<feature> --d6 --isolate
   ```
   (or `--d5 --isolate` for single-pill e2e). DO NOT use `--direct` for
   value-test — it bypasses the queue/worker pipeline staging actually runs and
   has misled investigations in the past.

10. **No fixture rewrite from real-LLM record/replay.** The canonical-phrase probe
    is anti-record/replay-against-real-LLM by construction: a real LLM won't emit
    the verbatim assertion phrase. Fixture content is authored truth; tune the
    `match` keys to fire on the right turn.

## Test-Gating Matrix

This matrix documents which CI workflows fire on which triggers, what they test, and whether they gate merges. Companion to [`QA-COVERAGE.md`](./QA-COVERAGE.md) -- that document tracks per-demo coverage; this one tracks per-workflow gating.

Scope: all testing-related workflows (unit, integration, e2e, smoke) across the monorepo. Data read directly from `.github/workflows/*.yml` on the current branch.

## Matrix

| Workflow file                                       | Name (CI UI)                      | Trigger                                                                                     | Path filter                                                                            | Required? | What it tests                                                                                    |
| --------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------ |
| `.github/workflows/test_unit.yml`                   | test / unit                       | push (main), pull_request (main), workflow_dispatch                                         | paths-ignore: `docs/**`, `README.md`, `examples/**`                                    | No        | Vitest unit suite across Node 20/22/24 for all TS packages                                       |
| `.github/workflows/test_unit-python-sdk.yml`        | test / unit / python-sdk          | push (main), pull_request (main)                                                            | `sdk-python/**`, this workflow                                                         | No        | pytest against `sdk-python/` under Python 3.12 + Poetry                                          |
| `.github/workflows/test_integration-runtime.yml`    | test / integration / runtime      | push (main), pull_request (main), workflow_dispatch                                         | `packages/runtime/**`, this workflow                                                   | No        | Runtime server integration tests (Node, possibly others)                                         |
| `.github/workflows/test_integration-docs.yml`       | test / integration / docs         | push (main), pull_request                                                                   | `docs/**`                                                                              | No        | Extracts code blocks from docs, runs them against aimock (model-name + doc-test)                 |
| `.github/workflows/test_e2e-dojo.yml`               | test / e2e / dojo                 | push (main), pull_request (main), workflow_dispatch                                         | `packages/**`, `sdk-python/**`, this workflow, `.changeset`                            | No        | ag-ui dojo end-to-end matrix on Depot runners                                                    |
| `.github/workflows/test_e2e-legacy-v1.yml`          | test / e2e / legacy-v1            | push (main), pull_request (main), workflow_dispatch                                         | `examples/**`, this workflow, `.changeset`                                             | No        | Legacy v1.x examples (form-filling, travel, research-canvas, chat-with-your-data, state-machine) |
| `.github/workflows/showcase_validate.yml`           | Showcase: Validate                | push (main), pull_request                                                                   | `showcase/**`, `examples/integrations/**/fixtures/**`, `scripts/doc-tests/fixtures/**` | No        | Build-pipeline Vitest + manifest/registry validation + shell build                               |
| `.github/workflows/test_e2e-showcase-on-demand.yml` | test / e2e / showcase / on-demand | issue_comment (`/test-aimock`), workflow_dispatch                                           | n/a (comment-gated)                                                                    | No        | aimock-backed Playwright E2E on demand per-package                                               |
| `.github/workflows/test_smoke-starter.yml`          | test / smoke / starter            | schedule (`0 */6 * * *`), workflow_run (publish / release), pull_request, workflow_dispatch | `examples/integrations/**`, this workflow                                              | No        | Docker-compose smoke for 12 starter integrations (build + curl)                                  |
| `.github/workflows/test_smoke-starter-deployed.yml` | test / smoke / starter-deployed   | schedule (`0 */6 * * *`), workflow_run (Showcase: Build & Deploy), workflow_dispatch        | n/a (scheduled / post-deploy)                                                          | No        | Playwright E2E against live deployed starter URLs (@starter-health/-agent/-chat)                 |

## Which tests run on a typical PR?

- `packages/**` (runtime/SDK): `test / unit`, `test / integration`, `test / e2e / dojo`, `static / quality`, `static / check binaries`, plus `static / danger` if `packages/sdk-js/src/langgraph.ts` is touched.
- `sdk-python/**`: `test / unit / python-sdk`, `test / e2e / dojo`, `static / check binaries`, plus `static / danger` if `copilotkit/langgraph_agent.py` is touched. `test / unit` also fires (paths-ignore does not exclude sdk-python).
- `showcase/**`: `Showcase: Validate`, `test / unit` (paths-ignore does not exclude showcase), `static / quality`, `static / check binaries`. No Playwright E2E runs automatically -- comment `/test-aimock` on the PR to trigger `test / e2e / showcase / on-demand`.
- `examples/**` (legacy v1.x): `test / e2e / legacy-v1`, `static / check binaries`. `test / unit` is excluded via paths-ignore.
- `examples/integrations/**` (starters): `test / smoke / starter` (Docker), `Showcase: Validate` (for fixtures only), `static / check binaries`.
- `docs/**`: `test / integration / docs` only. `test / unit` and `static / quality` are excluded via paths-ignore.
- `.github/workflows/**`: each workflow that lists its own path in its trigger runs (most do). No single "workflows changed" catch-all.

## Required status checks

None of the workflows above are enforced as required status checks. The active `PROTECT_OUR_MAIN` ruleset on `main` requires zero status contexts -- merges are gated only by review approval, not by CI outcome.

The legacy classic branch protection `required_status_checks.contexts` array contains stale entries (e.g. `test / unit`, `Showcase: Validate`) that appear in GitHub's API responses but are not evaluated by the active ruleset. If you see a CI workflow marked as "required" in an older doc or script, treat that as ghost data: nothing in GitHub's current enforcement path consumes it.

Practical consequence: a red CI run does not block merge. Reviewers must eyeball `gh pr checks` before approving.

## Footnotes

- `test / unit` matrix is Node 20/22/24; the other workflows pin a single Node version each (22 most common).
- `test / e2e / dojo` uses Depot runners (`depot-ubuntu-24.04`); all others use standard GitHub runners.
- `test / smoke / starter` and `test / smoke / starter-deployed` both run every 6h; the former validates Docker-build integrity of `examples/integrations/`, the latter validates the deployed Railway services.
- `workflow_run` triggers fire after another workflow completes -- they do not gate the triggering PR, they run post-merge.
