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
