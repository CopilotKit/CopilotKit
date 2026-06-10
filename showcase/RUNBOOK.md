# Showcase D5 (d6-all-pills) Runbook

Operational documentation for debugging and fixing showcase D5 probe failures locally.
Intended audience: engineers and AI agents working on showcase integrations.

## CLI Rules

ALWAYS use `bin/showcase` for all operations. Never raw `docker compose` or `docker build`.

```
bin/showcase up <slug>                      # start container
bin/showcase rebuild <slug>                 # code changes (new image)
bin/showcase test <slug> --d5               # run D5 probe
bin/showcase test <slug> --d6 --isolate <name>   # canonical d6 verification
```

- **`rebuild`** handles symlink dereferencing that raw `docker build` cannot (`tools/` and `shared-tools/` are symlinks to `../../shared/`).
- **`recreate`** for env/config changes (same image, new container).
- **`rebuild`** for code changes (new image).

## Verifying a Slug's D6 State (canonical flow)

To verify an integration's D6 state, run:

```
bin/showcase test <slug> --d6 --isolate <name>
```

This is THE default way to verify a slug. `--isolate <name>` brings up a fully
isolated stack — its own aimock + PocketBase + dashboard + integration +
harness control-plane and pool-worker — on offset ports in its own docker
compose project, then runs the canonical `harness/src/probes/drivers/d6-all-pills.ts`
driver: it enqueues per-pill jobs, the isolated worker claims them, and asserts
per-pill. This is **identical to the non-isolate path** — the same driver, the
same per-pill assertions — just on isolated ports/project so it doesn't disturb
the shared long-lived `showcase-*` stack.

Verifiers use THIS flow rather than hand-driving the browser. Hand-driving
breaks the identical-tests invariant: the whole point is that the same driver
runs and asserts per-pill the same way across every integration, so a result is
comparable to every other integration and to production. Manual clicking is
non-reproducible and tests something subtly different per run.

See [Isolated Verification Runs (`--isolate`)](#isolated-verification-runs---isolate)
below for the full mechanics and cleanup.

## Fixture Matching

D5 fixtures use `hasToolResult` (not `turnIndex`) for multi-turn disambiguation.

| Field                  | Meaning                                          |
| ---------------------- | ------------------------------------------------ |
| `hasToolResult: false` | First LLM call -- no tool result in messages yet |
| `hasToolResult: true`  | Follow-up call -- tool result present            |

`turnIndex` counts assistant messages, which varies across frameworks. **Do not use `turnIndex` in new fixtures.**

The `mcp-subagents` supervisor chain should also avoid `turnIndex`; chain each
follow-up on the prior tool call's `toolCallId` so repeated and interleaved pill
clicks replay the same way.

### Fixture locations

- **Source fixtures:** `showcase/harness/fixtures/d5/*.json` -- edit these, then rebuild bundle.
- **Bundle:** `showcase/aimock/d5-all.json` -- aggregate of all source fixtures. Rebuild after any source edit.

### Aimock debug logging

Add `--log-level debug` to the aimock command in `docker-compose.local.yml` to see fixture match/miss per request.

## Integration Patterns

These are canonical. Do not deviate.

### HITL (hitl-steps, hitl-approve-deny, hitl-text-input)

Backend agent has `tools=[]` (no backend tools). Frontend registers tools via `useHumanInTheLoop` or `useFrontendTool`. CopilotKit injects frontend tool definitions into the LLM call. Every HITL integration follows this pattern without exception.

### gen-ui-custom

`langgraph-python` uses the chart pattern (`useComponent` with `render_pie_chart`). All other integrations should also demonstrate meaningful custom generative UI. Do not replace charts/data-viz with trivial text-only components just to pass tests.

### tool-rendering

Frontend registers `useRenderTool` for `get_weather`. The v2 API uses `parameters` (not `args`) in the render callback. Backend has the actual tool.

### shared-state

Backend calls `set_notes` tool, must forward tool result back to LLM for the follow-up text response. Frameworks that don't auto-cycle (crewai, langroid) need explicit tool-execution loops.

## Docker Compose Environment

All providers must be routed through aimock. Required env vars in `x-integration-defaults`:

```
OPENAI_API_KEY / OPENAI_BASE_URL          -> http://aimock:4010/v1
ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL    -> http://aimock:4010
GOOGLE_API_KEY / GOOGLE_GEMINI_BASE_URL   -> http://aimock:4010
SPRING_AI_OPENAI_BASE_URL                 -> http://aimock:4010
```

Missing any of these means that provider's integrations bypass aimock and hit real APIs (or fail with an empty key).

## Debugging Sequence

1. Check container health: `docker compose -f showcase/docker-compose.local.yml ps`
2. Check container logs: `docker logs showcase-<slug> --tail 30`
3. Enable aimock debug: add `--log-level debug` to compose command
4. Run test: `bin/showcase test <slug> --d5 --verbose`
5. Check aimock logs for fixture matching: `docker logs showcase-aimock 2>&1 | grep "Fixture matched\|No fixture"`
6. If fixture matches but test fails: frontend/runtime issue (check component rendering, testid attributes)
7. If fixture does not match: check `hasToolResult`, `userMessage` substring matching
8. If zero aimock requests: check base URL env var for that provider

## Production Debugging

### Harness probe logging

The harness emits structured logs at INFO level for probe lifecycle events:

- `probe.tick-start` / `probe.tick-complete` — probe run lifecycle
- `probe.target-start` / `probe.target-complete` — per-service results
- `probe.d6-all-pills.service-start` / `probe.d6-all-pills.service-complete` — D5 per-service
- `probe.d6-all-pills.feature-complete` — per-feature pass/fail with error details
- `probe.run-summary` — single line with all service results
- `probe.d6-all-pills.pool-abort-release` — browser pool starvation events

View with: `RAILWAY_PROJECT_ID=6f8c6bff-a80d-4f8f-b78d-50b32bcf4479 railway logs --service showcase-harness --tail 200`

### Debug-level probe logging

For detailed conversation-runner traces (selector resolution, DOM text extraction, settle polling, per-turn lifecycle), set `LOG_LEVEL=debug` on the showcase-harness Railway service. This enables `console.debug(...)` output from the conversation runner and D5 scripts.

To enable temporarily: set the env var in Railway dashboard → showcase-harness → Variables → `LOG_LEVEL=debug`. The service auto-restarts. Remember to unset after debugging — debug output is verbose.

### Triggering probes manually

```
curl -sf -X POST "https://showcase-harness-production.up.railway.app/api/probes/probe:d6-all-pills-e2e/trigger" \
  -H "Authorization: Bearer $OPS_TRIGGER_TOKEN" \
  -H "Content-Type: application/json"
```

Retrieve `OPS_TRIGGER_TOKEN`: `RAILWAY_PROJECT_ID=6f8c6bff-a80d-4f8f-b78d-50b32bcf4479 railway variables --service showcase-harness --json | python3 -c "import json,sys; print(json.load(sys.stdin)['OPS_TRIGGER_TOKEN'])"`

Rate limit: 5 minutes per probe ID.

### Testing package.json changes

When `package.json` changes (new deps, version bumps), volume mounts don't cover `node_modules`. You MUST rebuild the Docker image: `bin/showcase rebuild <slug>`, then re-test. A passing `bin/showcase test` against a volume-mounted container does NOT validate the build.

## Isolated Verification Runs (`--isolate`)

`--isolate <name>` is the default way to verify a slug (see [Verifying a Slug's
D6 State](#verifying-a-slugs-d6-state-canonical-flow)). It brings up a fully
isolated stack on offset ports in its own docker compose project and runs the
canonical `d6-all-pills` driver against it — identical to the non-isolate path,
just namespaced so it never touches the shared `showcase-*` stack.

```
bin/showcase test <slug> --d6 --isolate <name>
```

### How it works

- **`<name>`**: names the isolated compose project. It must start with a
  lowercase letter or digit, followed by lowercase letters, digits, `-` or `_`
  (`[a-z0-9][a-z0-9_-]*`, a docker compose project-name constraint); uppercase
  is normalized to lowercase with a warning. The name `showcase` is reserved —
  it is the default stack's own compose project name, so the CLI refuses it.
  Use a distinct name per run so concurrent runs never collide.
- **Auto-assigned slot and port offset**: each run atomically claims a slot
  (0–45) and derives its port offset as `(slot + 1) * 200` — slot 0 → +200,
  slot 1 → +400, and so on. **Do not assign slots or offsets manually**; the
  CLI claims and frees them for you. Up to 46 concurrent isolated runs are
  supported.
- **Full isolated stack**: its own aimock, PocketBase, dashboard, integration,
  and harness control-plane + pool-worker, all on the offset ports under the
  `<name>` compose project.
- **Does NOT touch the shared stack**: the default/long-lived `showcase-*`
  project is left completely alone, so an isolated run is safe to launch
  alongside it (or alongside other isolated runs).
- **PocketBase authenticates out of the box**: the host CLI's default PocketBase
  superuser (`admin@example.com` / `showcase-local-dev`) matches the
  `POCKETBASE_SUPERUSER_EMAIL` the compose stack seeds, so a fresh isolated PB
  authenticates with no manual setup. (A mismatch here is what previously 400'd
  on pb-auth and left the control-plane enqueuing zero jobs.)
- **Originals are never modified**: the flag writes offset copies of
  `docker-compose.local.yml` and `shared/local-ports.json` into a per-run
  scratch dir at
  `${XDG_STATE_HOME:-$HOME/.local/state}/copilotkit/showcase/runs/<name>/`.
  If the process crashes, the originals are untouched.

### Interpreting results

Per-pill FAILs in an isolated run reflect real demo/feature issues for that
integration — not artifacts of isolation. The driver runs and asserts per-pill
identically across every integration, so a FAIL is the same signal you'd get
from the shared stack or production for that pill.

### Cleanup

By default an isolated run tears its stack down on exit (via `trap EXIT`) and
frees its slot automatically — the normal, no-cleanup-needed case. Each fresh
run gets a clean PocketBase volume, which is what makes pb-auth deterministic.

To leave the stack up for inspection after the run, pass `--keep`: the isolated
stack survives the run (success or failure), and the run dir and slot are
preserved — the live containers keep the slot from being reaped. That
protection lasts only while the containers are RUNNING: if they stop (manual
`docker stop`, a daemon restart, a host reboot), the next isolate run's sweep
reclaims the slot — composing the stopped containers and named volumes down and
removing the run dir. Inspect a kept stack before stopping it, and don't expect
it to survive a reboot. At exit the CLI prints a survival notice with the
stack's host ports (aimock, dashboard, PocketBase) and the manual teardown
command:

```sh
docker compose -p <name> down --remove-orphans --volumes && rm -rf <run-dir> <slot-dir>
```

The teardown includes `--volumes`: isolated stacks are ephemeral, so the
project-scoped named volumes (e.g. `<name>_showcase-pb-data`) are removed along
with the containers and networks — the same flags the automatic (non-`--keep`)
teardown uses, so a kept stack leaves nothing behind once torn down. The
`rm -rf` clears the per-run scratch dir and the slot reservation (the notice
prints the real paths).

If a run was killed with `SIGKILL` (so the trap never fired), the next isolate
run auto-reaps the dead slot (a slot whose compose project has no live
containers is reclaimed). To clean up the slot reservations manually:

```sh
rm -rf "${XDG_STATE_HOME:-$HOME/.local/state}/copilotkit/showcase/slots"/*
```

- **Stale `.iso-bak` files**: if you see `docker-compose.local.yml.iso-bak` or
  `local-ports.json.iso-bak`, those are leftovers from an old isolate behavior
  that mutated files in place. The current code auto-restores them on startup,
  but you can also clean up manually with `git checkout` on the affected files.

## Anti-Patterns

Earned by bugs. Do not repeat.

- **NEVER** change a demo's fundamental functionality to pass a test. The demo IS the point.
- **NEVER** replace chart/data-viz gen-ui with trivial text components.
- **NEVER** use `turnIndex` in new fixtures. Use `hasToolResult`.
- **NEVER** use raw `docker build`. Symlinks break. Use `bin/showcase rebuild`.
- **NEVER** assume "agent says done" means "D5 is green." Always run the actual test.
- **NEVER** add a backend tool for something that should be a frontend HITL tool.

## Aimock Fixture Deployment

When adding or modifying fixture files in `showcase/aimock/`, the `showcase-aimock` image must be rebuilt so production picks up the changes. CI handles this automatically -- any push to `main` that touches `showcase/aimock/**` triggers the Build & Deploy workflow to rebuild and redeploy the image.

For manual iteration (e.g. testing a fixture change before merging), build and push directly:

```
docker build --platform linux/amd64 -f showcase/aimock/Dockerfile -t ghcr.io/copilotkit/showcase-aimock:latest showcase/aimock/ --push
```

After pushing, redeploy the Railway service so it pulls the new image (the CI workflow does this automatically via `serviceInstanceRedeploy`).

When adding a **new** fixture file, update both:

1. `showcase/docker-compose.local.yml` -- add a volume mount for the new file
2. `showcase/aimock/Dockerfile` -- add a `COPY` line for the new file

## Dev Iteration Speed

Each integration service bind-mounts its host `src/` directory into the container via the `volumes` entry in `docker-compose.local.yml`:

```yaml
volumes:
  - ./integrations/<slug>/src:/app/src
```

This means **source edits take effect on container restart** without rebuilding the Docker image. The workflow becomes:

1. Edit code under `showcase/integrations/<slug>/src/`
2. Restart the container: `bin/showcase restart <slug>`
3. Re-run the test: `bin/showcase test <slug> --d5`

Use `bin/showcase rebuild <slug>` only when you change dependencies (requirements.txt, package.json) or non-src files (Dockerfile, entrypoint). For pure `src/` changes, restart is sufficient and much faster.
