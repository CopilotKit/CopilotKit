# Local runtime audit log

## Run metadata

- Revision: `fa6041fc7b08fc5866099769038e43c44c1ce8df`
- Scope: React showcase runtime, fixture-backed AIMock only; no provider credentials.
- Selected backends: `langgraph-python`, `langgraph-typescript`, `google-adk`, `strands`, `built-in-agent`.

## Attempt 1 — inconclusive

- Command: `showcase/bin/showcase test langgraph-python --smoke --isolate audit-lgp-smoke --verbose --cycle`
- Result: no test result. The command reached shared-module staging and Angular browser-artifact build before its execution session ended; Compose services did not start and no audit containers remained.
- Evidence retained outside the repository: `/private/tmp/audit-lgp-smoke-initial-tool-output.txt` is not available; subsequent attempts use redirected logs under this directory.
- Classification: **UNTESTED**, not a pass or failure.

## Attempt 2 — setup blocked

- Command: `showcase/bin/showcase test langgraph-python --smoke --isolate audit-lgp-smoke2 --verbose --cycle`
- Result: **SETUP-BLOCKED** before Compose created a container. The runner requires `showcase/.env`; that ignored file was absent. Full output: `tasks/docs-feature-audit/lgp-smoke2.log`.
- Remediation performed: created ignored `showcase/.env` from the repository's documented `.env.example`, mode `0600`. It contains placeholders only; no provider credentials were introduced.

## Attempt 3 — environment capacity blocked

- Command: `showcase/bin/showcase test langgraph-python --smoke --isolate audit-lgp-smoke3 --verbose --cycle`
- Result: **SETUP-BLOCKED** before the LangGraph Python service or a fixture test started. Docker Compose tried to build missing local prerequisites (`showcase-pocketbase`, `showcase-harness`, `showcase-dashboard`) and overlayfs failed with `no space left on device` while preparing the PocketBase build. Full output: `tasks/docs-feature-audit/lgp-smoke3.log`.
- Docker accounting at failure: 23 images / 50.24 GB, build cache 20.71 GB, 57 containers / 265 MB, local volumes 4.239 GB. No pruning or deletion was performed.
- Classification: **UNTESTED** for all five selected backends; this is a local-capacity setup blocker, not an integration or documentation defect.

## Runtime status at pause

| Backend                | Requested coverage  | Current status | Reason                                                          |
| ---------------------- | ------------------- | -------------- | --------------------------------------------------------------- |
| `langgraph-python`     | smoke, then full D6 | UNTESTED       | prerequisite Compose build blocked by Docker storage exhaustion |
| `langgraph-typescript` | smoke, then full D6 | UNTESTED       | not started; same shared prerequisite stack                     |
| `google-adk`           | smoke, then full D6 | UNTESTED       | not started; same shared prerequisite stack                     |
| `strands`              | smoke, then full D6 | UNTESTED       | not started; same shared prerequisite stack                     |
| `built-in-agent`       | smoke, then full D6 | UNTESTED       | not started; same shared prerequisite stack                     |

The normal local runner selects all manifest-wired demos for the slug. It is suitable for the requested post-smoke D6 runs, but no D5-only substitution has been made.

## Static D6 coverage evidence (local, no Docker)

- Manifest route-to-probe audit: all 194 routed demo IDs across the five selected integrations resolve through the shared D5/D6 feature mapping. The per-slug routed/mapped counts are 39/39, 39/39, 38/38, 39/39, and 39/39 (in selected-slug order). The 187 declared-feature count remains a different catalog metric. Machine-readable evidence: `tasks/docs-feature-audit/d6-route-mapping-audit.json`.
- Command: `pnpm nx run @copilotkit/showcase-harness:test -- --run src/probes/frontend-matrix.test.ts src/probes/helpers/d5-feature-mapping.test.ts src/probes/helpers/d5-mapping-drift.test.ts`
- Result: **PASS** — 3 files / 9 tests. The matrix rejects a runnable feature without a deterministic mapping, and the harness/dashboard maps remain structurally aligned.
- Command: `pnpm nx run @copilotkit/showcase-harness:test -- --run src/probes/drivers/d6-all-pills.test.ts src/probes/helpers/d5-representatives.test.ts`
- Result: **PASS** — 2 files / 61 tests. These validate full-matrix (not representative-only) driver behavior and dynamic script loading; the D6 driver treats a missing script as a red result.
- Command: `showcase/bin/showcase fixtures validate --fixture-dir showcase/aimock/d6/<slug>` for each selected slug.
- Result: JSON structural validation completed for 43/43/41/42/40 files and 344/343/334/322/349 fixture entries. It emitted 70/77/67/60/64 duplicate-message warnings (338 total) but no syntax/empty-response failure. These warnings are validator output, not behavior passes and not newly classified defects.
- Static evidence establishes intended coverage wiring only. It cannot establish rendered behavior, fixture match success, or backend protocol compatibility; those remain **UNTESTED** until the Docker capacity blocker is resolved.

## Fixture-reference limitation

- The harness's representative-fixture table provides 29 unique filenames for each of LangGraph Python, LangGraph TypeScript, Google ADK, and Built-in Agent, and 28 for Strands. A literal filename check against each integration's `aimock/d6/<slug>/` directory leaves 3/3/4/3/4 names absent (17 reference-name mismatches total). Evidence: `tasks/docs-feature-audit/d6-representative-fixture-audit.json`.
- This is **UNVERIFIED**, not a confirmed missing-fixture defect: the unmatched names are semantic aliases and the D6 driver does not resolve those table entries directly. AIMock selects fixtures independently from the conversation request. The structural validator checks individual JSON files, but has no cross-reference check from route/script to actual AIMock response.
- A full local D6 run uses strict AIMock matching, so it is the deciding behavior check; a no-match becomes a red result. Do not describe the static pass as fixture-match coverage.

## Attempt 4 — fresh-image rebuild capacity blocked

- The user approved removal of unused Docker build cache only. `docker builder prune --all --force` completed successfully and reclaimed 20.71 GB; images, containers, and volumes were retained.
- Command: `showcase/bin/showcase test langgraph-python --smoke --isolate audit-lgp-smoke4 --verbose --cycle`
- Result: **FRESH-IMAGE-UNTESTED**. The isolated Compose lifecycle started its cached infra services, then failed rebuilding the targeted LangGraph Python image at the Dockerfile frontend `node_modules` copy with `no space left on device`. Full output: `tasks/docs-feature-audit/lgp-smoke4.log`.
- The failed target rebuild regenerated 17.08 GB of BuildKit cache. No additional Docker cleanup was performed.

## Attempt 5 — running-stack liveness only

- The failed rebuild left an isolated stack running and healthy for LangGraph Python (`http://localhost:3500/api/health`) and AIMock (`http://localhost:4410/health`); its dashboard was unhealthy. The wrapper could not reuse the occupied isolation slot and incorrectly selected a new unused slot, where it failed to fetch a service. That result is excluded from feature status.
- Direct command against the existing Compose project, without a Docker lifecycle operation: `COMPOSE_PROJECT_NAME=audit-lgp-smoke4 SHOWCASE_COMPOSE_FILE=<repo>/showcase/docker-compose.local.yml LOCAL_PORTS_FILE=/private/tmp/audit-lgp-smoke4-ports.json SHOWCASE_INFRA_PORT_OFFSET=400 SHOWCASE_LOCAL=1 node_modules/.bin/tsx showcase/harness/src/cli.ts test langgraph-python --smoke --verbose`
- Result: **PASS** — local LangGraph Python health probe. Output: `tasks/docs-feature-audit/lgp-smoke4-direct.log`.
- Provenance caveat: this is liveness evidence for an already running image. Because the target fresh-image rebuild failed, it does not qualify the current `fa6041fc7b08fc5866099769038e43c44c1ce8df` product snapshot or latest stable dependency set, and it is not feature/D6 evidence.

## Attempt 6 — stale-stack D6 infrastructure failure

- Command: direct local harness invocation as above with `test langgraph-python --d6 --direct --verbose`, retaining the same isolated Compose project and +400 ports.
- Result: **INVALID FOR CURRENT SNAPSHOT**. The D6 driver fanned out but reported zero feature passes; every route navigation encountered connection reset/socket errors. Full output: `tasks/docs-feature-audit/lgp-d6-direct.log`.
- Read-only container state/log evidence: the target container restarted once and LangGraph failed to load its graph because `_shared` could not be imported from `src/agents/main.py`, producing a `GraphLoadError`. This identifies a failure of the pre-existing stack/image under test, but a fresh target image could not be produced. Do not classify it as a defect in the current source revision until host-native or fresh-image reproduction confirms it.

## Attempt 7 — host-native current-source strict D6

- Provenance: source revision `fa6041fc7b08fc5866099769038e43c44c1ce8df`; local host applications started from that checkout by the audit setup; fixture-only AIMock at `http://127.0.0.1:4410`; fake provider variables only; no external provider or deployment target. The reusable audit-only ESM runner is `tasks/docs-feature-audit/run-local-d6.mts` and dynamically loads the normal D5/D6 scripts before invoking `buildFullInputs` and `createE2eFullDriver`. It preserves strict AIMock matching and writes no canonical product data.
- Version scope: these are source-declared dependency results, not latest-stable qualification. The public latest `@copilotkit/react-core` observed separately was `1.71.0`; source-declared pins must be retained for reproducibility and reported alongside any later isolated latest-stable overlay.

| Backend                | Local endpoint                             | Completed D6 checks | Green | Red | Status and durable evidence                                                                                                        |
| ---------------------- | ------------------------------------------ | ------------------: | ----: | --: | ---------------------------------------------------------------------------------------------------------------------------------- |
| `built-in-agent`       | `http://127.0.0.1:3117`                    |                  39 |    35 |   4 | **COMPLETE WITH REDS** — `built-in-agent-host-d6-esm.log`                                                                          |
| `langgraph-python`     | `http://127.0.0.1:3100`                    |                  40 |    38 |   2 | **COMPLETE WITH REDS** — `langgraph-python-host-d6-esm.log`                                                                        |
| `langgraph-typescript` | `http://127.0.0.1:3101`                    |                  40 |    37 |   3 | **COMPLETE WITH REDS** — `langgraph-typescript-host-d6-esm-webpack.log`                                                            |
| `google-adk`           | no local UI; agent `http://127.0.0.1:8001` |                   0 |     0 |   0 | **SETUP-BLOCKED** — checked-in UI start reaches duplicate equally-specific auth routes before listening; no route behavior claimed |
| `strands`              | `http://127.0.0.1:3112`                    |             running |     — |   — | **IN PROGRESS** — `strands-host-d6-esm.log`                                                                                        |

- Built-in Agent red checks: `gen-ui-agent` DOM-settle timeout; `multimodal` DOM-settle timeout; `voice` no assistant completion; `threadid-frontend-tool-roundtrip` strict AIMock 503/no fixture match. The initial multimodal failure displayed an LFS pointer. All 15 selected-five sample PNG/PDF/WAV assets were then fetched by exact path and validated; the targeted current host rerun remained red after two 60-second DOM-settle timeouts, so its final classification is a behavior/execution candidate, not a local-LFS blocker. Evidence: `built-in-agent-multimodal-lfs-rerun.log`.
- LangGraph Python red checks: `voice` and `multimodal`, both no assistant completion/DOM-settle timeout after retry. Exact LFS media were present for this run. No strict AIMock 503 or pointer error appeared. These are behavior candidates, not confirmation of a source defect.
- LangGraph TypeScript red checks on the valid Webpack run: `gen-ui-declarative` DOM-settle timeout; `multimodal` page navigation load timeout; `byoc` declarative-hashbrown page navigation load timeout. An earlier default-Turbopack run was terminated at 18 checks and is **invalid for feature qualification** because the UI resolved tracked CVDIAG `.js` specifiers to missing leaves, producing module-resolution overlays/500s. That default-dev setup defect is retained independently in `langgraph-typescript-host-d6-esm-invalid-turbopack.log`; the unchanged-source Webpack run is the qualification evidence.
- Per-check evidence includes aggregate totals, feature IDs, retries, timings, and diagnostics in the listed logs. `writer-missing` only indicates the optional PocketBase result writer was deliberately absent; it does not suppress a driver verdict.

## D6 execution-unit reconciliation

- The D6 runner produced 40 execution units for LangGraph Python and TypeScript even though the route inventory has 39 demo IDs. Top-level manifest expansion, Beautiful Chat sub-feature expansion, and BYOC deduplication make these different measures.
- Two routed interrupt demos (`gen-ui-interrupt`, `interrupt-headless`) are explicitly manifest-not-supported/quarantined and are excluded from D6 execution. They are **policy-excluded / UNTESTED**, not failed or passed. Reporting must not imply every routed demo passed.

- Strands host-native strict D6 completed after the checkpoint: 36 execution units, 34 green, 2 red in 208.8 seconds. `voice` and `multimodal` both reached a DOM-settle timeout with no assistant response after retry; all exact LFS media were present. `shared-state-read` passed its two asserted turns, but its existing assertion does not by itself prove the separate recipe-context source candidate. Evidence: `tasks/docs-feature-audit/strands-host-d6-esm.log`.
