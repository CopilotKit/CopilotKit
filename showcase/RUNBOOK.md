# Showcase D5 (e2e-deep) Runbook

Operational documentation for debugging and fixing showcase D5 probe failures locally.
Intended audience: engineers and AI agents working on showcase integrations.

## CLI Rules

ALWAYS use `bin/showcase` for all operations. Never raw `docker compose` or `docker build`.

```
bin/showcase up <slug>          # start container
bin/showcase rebuild <slug>     # code changes (new image)
bin/showcase test <slug> --d5   # run D5 probe
```

- **`rebuild`** handles symlink dereferencing that raw `docker build` cannot (`tools/` and `shared-tools/` are symlinks to `../../shared/`).
- **`recreate`** for env/config changes (same image, new container).
- **`rebuild`** for code changes (new image).

## Fixture Matching

D5 fixtures use `hasToolResult` (not `turnIndex`) for multi-turn disambiguation.

| Field                  | Meaning                                          |
| ---------------------- | ------------------------------------------------ |
| `hasToolResult: false` | First LLM call -- no tool result in messages yet |
| `hasToolResult: true`  | Follow-up call -- tool result present            |

`turnIndex` counts assistant messages, which varies across frameworks. **Do not use `turnIndex` in new fixtures.**

**Exception:** `mcp-subagents` supervisor chain uses `turnIndex` 1-3 for steps beyond the first, because `hasToolResult` alone cannot disambiguate 4+ sequential calls.

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
- `probe.e2e-deep.service-start` / `probe.e2e-deep.service-complete` — D5 per-service
- `probe.e2e-deep.feature-complete` — per-feature pass/fail with error details
- `probe.run-summary` — single line with all service results
- `probe.e2e-deep.pool-abort-release` — browser pool starvation events

View with: `RAILWAY_PROJECT_ID=6f8c6bff-a80d-4f8f-b78d-50b32bcf4479 railway logs --service showcase-harness --tail 200`

### Debug-level probe logging

For detailed conversation-runner traces (selector resolution, DOM text extraction, settle polling, per-turn lifecycle), set `LOG_LEVEL=debug` on the showcase-harness Railway service. This enables `console.debug(...)` output from the conversation runner and D5 scripts.

To enable temporarily: set the env var in Railway dashboard → showcase-harness → Variables → `LOG_LEVEL=debug`. The service auto-restarts. Remember to unset after debugging — debug output is verbose.

### Triggering probes manually

```
curl -sf -X POST "https://showcase-harness-production.up.railway.app/api/probes/probe:e2e-deep/trigger" \
  -H "Authorization: Bearer $OPS_TRIGGER_TOKEN" \
  -H "Content-Type: application/json"
```

Retrieve `OPS_TRIGGER_TOKEN`: `RAILWAY_PROJECT_ID=6f8c6bff-a80d-4f8f-b78d-50b32bcf4479 railway variables --service showcase-harness --json | python3 -c "import json,sys; print(json.load(sys.stdin)['OPS_TRIGGER_TOKEN'])"`

Rate limit: 5 minutes per probe ID.

### Testing package.json changes

When `package.json` changes (new deps, version bumps), volume mounts don't cover `node_modules`. You MUST rebuild the Docker image: `bin/showcase rebuild <slug>`, then re-test. A passing `bin/showcase test` against a volume-mounted container does NOT validate the build.

## Isolated Test Runs (`--isolate`)

Use `--isolate` when another agent or terminal session is already running showcase locally. It prevents port collisions and container name conflicts by scoping everything into a temporary overlay.

```
bin/showcase test <slug> --d5 --isolate
```

### Operational notes

- **Required when sharing a machine**: If any other session has `showcase up` running, use `--isolate` to avoid stomping on its containers and ports.
- **Parallel runs supported**: Up to 46 concurrent `--isolate` runs. Each gets a unique port range (slot 0 = +200, slot 1 = +400, ...) and a scoped docker compose project name.
- **Originals are never modified**: The flag writes temp copies of `docker-compose.local.yml` and `shared/local-ports.json` to `$TMPDIR/showcase-isolate-$$/`. If the process crashes, originals are untouched.
- **Cleanup is automatic**: The temp directory and slot are released on exit (via `trap EXIT`). If a run was killed with `SIGKILL`, clean up manually:

  ```sh
  # Remove orphaned containers from a specific isolated run:
  docker compose --project-name <name> down

  # Clear all stale slot reservations:
  rm -rf /tmp/showcase-isolate-slots/*
  ```

- **Stale `.iso-bak` files**: If you see `docker-compose.local.yml.iso-bak` or `local-ports.json.iso-bak`, those are leftovers from the old (pre-PR#4570) isolate behavior. The new code auto-restores them on startup, but you can also clean up manually with `git checkout` on the affected files.

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
