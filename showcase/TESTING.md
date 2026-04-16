# Test-Gating Matrix

This matrix documents which CI workflows fire on which triggers, what they test, and whether they gate merges. Companion to [`QA-COVERAGE.md`](./QA-COVERAGE.md) -- that document tracks per-demo coverage; this one tracks per-workflow gating.

Scope: all testing-related workflows (unit, integration, e2e, smoke) across the monorepo. Data read directly from `.github/workflows/*.yml` on the current branch.

## Matrix

| Workflow file                                  | Name (CI UI)                 | Trigger                                                                                     | Path filter                                                                            | Required? | What it tests                                                                                    |
| ---------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------ |
| `.github/workflows/test_unit.yml`              | test / unit                  | push (main), pull_request (main), workflow_dispatch                                         | paths-ignore: `docs/**`, `README.md`, `examples/**`                                    | No        | Vitest unit suite across Node 20/22/24 for all TS packages                                       |
| `.github/workflows/test_unit-python-sdk.yml`   | test / unit / python-sdk     | push (main), pull_request (main)                                                            | `sdk-python/**`, this workflow                                                         | No        | pytest against `sdk-python/` under Python 3.12 + Poetry                                          |
| `.github/workflows/test_runtime-servers.yml`   | test / integration           | push (main), pull_request (main), workflow_dispatch                                         | `packages/runtime/**`, this workflow                                                   | No        | Runtime server integration tests (Node, possibly others)                                         |
| `.github/workflows/test_doc-examples.yml`      | test / doc-examples          | push (main), pull_request                                                                   | `docs/**`                                                                              | No        | Extracts code blocks from docs, runs them against aimock (model-name + doc-test)                 |
| `.github/workflows/e2e_dojo.yml`               | test / e2e / dojo            | push (main), pull_request (main), workflow_dispatch                                         | `packages/**`, `sdk-python/**`, this workflow, `.changeset`                            | No        | ag-ui dojo end-to-end matrix on Depot runners                                                    |
| `.github/workflows/e2e_examples.yml`           | test / e2e / examples        | push (main), pull_request (main), workflow_dispatch                                         | `examples/**`, this workflow, `.changeset`                                             | No        | Legacy v1.x examples (form-filling, travel, research-canvas, chat-with-your-data, state-machine) |
| `.github/workflows/showcase_validate.yml`      | Showcase: Validate           | push (main), pull_request                                                                   | `showcase/**`, `examples/integrations/**/fixtures/**`, `scripts/doc-tests/fixtures/**` | No        | Build-pipeline Vitest + manifest/registry validation + shell build                               |
| `.github/workflows/showcase_aimock-e2e.yml`    | Showcase: Aimock E2E Tests   | issue_comment (`/test-aimock`), workflow_dispatch                                           | n/a (comment-gated)                                                                    | No        | aimock-backed Playwright E2E on demand per-package                                               |
| `.github/workflows/showcase_smoke-monitor.yml` | Showcase: Smoke Monitor      | schedule (`*/15 * * * *`), workflow_dispatch                                                | n/a (scheduled)                                                                        | No        | Pings deployed showcase Railway URLs every 15 min, alerts on fail                                |
| `.github/workflows/starter-smoke.yml`          | Starter Smoke Tests          | schedule (`0 */6 * * *`), workflow_run (publish / release), pull_request, workflow_dispatch | `examples/integrations/**`, this workflow                                              | No        | Docker-compose smoke for 12 starter integrations (build + curl)                                  |
| `.github/workflows/starter_deployed_smoke.yml` | Starter Deployed Smoke Tests | schedule (`0 */6 * * *`), workflow_run (Showcase: Build & Deploy), workflow_dispatch        | n/a (scheduled / post-deploy)                                                          | No        | Playwright E2E against live deployed starter URLs (@starter-health/-agent/-chat)                 |

## Which tests run on a typical PR?

- `packages/**` (runtime/SDK): `test / unit`, `test / integration`, `test / e2e / dojo`, `static / quality`, `static / check binaries`, plus `static / danger` if `packages/sdk-js/src/langgraph.ts` is touched.
- `sdk-python/**`: `test / unit / python-sdk`, `test / e2e / dojo`, `static / check binaries`, plus `static / danger` if `copilotkit/langgraph_agent.py` is touched. `test / unit` also fires (paths-ignore does not exclude sdk-python).
- `showcase/**`: `Showcase: Validate`, `test / unit` (paths-ignore does not exclude showcase), `static / quality`, `static / check binaries`. No Playwright E2E runs automatically -- comment `/test-aimock` on the PR to trigger `Showcase: Aimock E2E Tests`.
- `examples/**` (legacy v1.x): `test / e2e / examples`, `static / check binaries`. `test / unit` is excluded via paths-ignore.
- `examples/integrations/**` (starters): `Starter Smoke Tests` (Docker), `Showcase: Validate` (for fixtures only), `static / check binaries`.
- `docs/**`: `test / doc-examples` only. `test / unit` and `static / quality` are excluded via paths-ignore.
- `.github/workflows/**`: each workflow that lists its own path in its trigger runs (most do). No single "workflows changed" catch-all.

## Required status checks

None of the workflows above are enforced as required status checks. The active `PROTECT_OUR_MAIN` ruleset on `main` requires zero status contexts -- merges are gated only by review approval, not by CI outcome.

The legacy classic branch protection `required_status_checks.contexts` array contains stale entries (e.g. `test / unit`, `Showcase: Validate`) that appear in GitHub's API responses but are not evaluated by the active ruleset. If you see a CI workflow marked as "required" in an older doc or script, treat that as ghost data: nothing in GitHub's current enforcement path consumes it.

Practical consequence: a red CI run does not block merge. Reviewers must eyeball `gh pr checks` before approving.

## Footnotes

- `test / unit` matrix is Node 20/22/24; the other workflows pin a single Node version each (22 most common).
- `test / e2e / dojo` uses Depot runners (`depot-ubuntu-24.04`); all others use standard GitHub runners.
- `starter-smoke` and `starter_deployed_smoke` both run every 6h; the former validates Docker-build integrity of `examples/integrations/`, the latter validates the deployed Railway services.
- `Showcase: Smoke Monitor` is the only 15-minute heartbeat; it only hits deployed URLs (no repo checkout).
- `workflow_run` triggers fire after another workflow completes -- they do not gate the triggering PR, they run post-merge.
