# Showcase Local Debugging Playbook

Quick-reference for running, debugging, and iterating on showcase integrations locally.

## Prerequisites

See [README.md](README.md) for Docker/Colima/OrbStack setup, API key configuration, and the general layout of the showcase directory. This document assumes you have a working Docker engine and a populated `.env` file.

## CLI Reference

The unified CLI is at `bin/showcase`. It wraps Docker Compose and adds debugging-specific commands. All commands can be run from any directory -- paths are resolved relative to the script itself.

```sh
# From repo root:
./showcase/bin/showcase <command> [args...]

# Or from within showcase/:
./bin/showcase <command> [args...]
```

### Core Commands

| Command                    | Description                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| `showcase up [slug...]`    | Start containers (rebuilds if source changed). No args = infra only (aimock, pocketbase, dashboard) |
| `showcase down [slug...]`  | Stop containers. No args = stop everything                                                          |
| `showcase build [slug...]` | Build Docker images without starting containers                                                     |
| `showcase ps`              | Show running containers and their status                                                            |
| `showcase ports`           | Print slug-to-host-port mapping (from `shared/local-ports.json`)                                    |
| `showcase logs <slug>`     | Follow container logs (supports `--grep`, `--since`, `-n`, `--no-follow`)                           |

### Debugging Commands

| Command                      | Description                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `showcase aimock-rebuild`    | Rebuild local aimock from a source checkout and redeploy the container                               |
| `showcase recreate <slug>`   | Force-recreate a service (picks up a newly built image)                                              |
| `showcase test <slug>`       | Run probe tests against a running service                                                            |
| `showcase fixtures validate` | Check fixture JSON files for structural errors, duplicates, and common mistakes                      |
| `showcase doctor`            | Diagnose common local stack issues (Docker engine, Depot interception, stale images, port conflicts) |
| `showcase diff-logs <slug>`  | Show log output for a specific time window, filtering out noise from before your change              |

## The Debugging Loop

This is the iterative process for going from a red probe to green. Each section below is a phase you will cycle through. Most debugging sessions follow the same pattern: establish baseline, trace what aimock sees, fix, re-test.

### Phase 1: Establish the Red Baseline

Start the infrastructure and run the failing test to see the exact error:

```sh
showcase up aimock mastra        # or whatever slug is failing
showcase test mastra --d5 --verbose
```

What to look for in the output -- the specific probe name and error message. Common patterns:

- **"chained reply missing fragments after 30000ms"** -- fixture matching issue. The agent is sending requests that don't match any fixture, so aimock returns 404 and the agent stalls.
- **"timeout"** -- container not responding. The service may not have started, may be crash-looping, or may be listening on the wrong port. Check logs first.
- **"404"** -- endpoint not found. The demo route doesn't exist, or the agent backend path is wrong. Check the integration's routing config.
- **"JS error on page"** -- a frontend error is crashing the demo. Use Playwright UI mode (`npx playwright test --ui`) from the integration directory to see the browser and open DevTools.

### Phase 2: Trace Fixture Matching

When an agent loops, stalls, or produces wrong output, the answer is almost always in what aimock is matching (or failing to match):

```sh
showcase logs aimock --grep "fixture|match|NO match|404"
```

What the log lines mean:

- **"matched fixture X at turnIndex N"** -- aimock found a fixture for this request and is returning it. If the same turnIndex repeats, the supervisor is stuck in a loop (re-sending the same request and getting the same canned response).
- **"NO match"** -- the request pattern doesn't match any fixture. This means either the fixture is missing, or the request shape has changed (different model, different system prompt, different tool definitions).
- **Repeated matches at the same turnIndex** -- the agent's retry/loop logic is firing because it didn't get the response it expected from the previous turn. The fixture chain is broken somewhere upstream.

### Phase 3: The aimock Edit-Build-Deploy-Test Cycle

This is the most repeated cycle during debugging. When you need to change aimock's behavior (response format, fixture matching logic, streaming behavior), the `aimock-rebuild` command automates the full rebuild-and-redeploy:

```sh
# 1. Edit aimock source (e.g., src/responses.ts, src/fixture-matcher.ts)

# 2. Rebuild and redeploy:
showcase aimock-rebuild --from /path/to/aimock

# 3. Run the test:
showcase test mastra --d5 --verbose --cycle
```

The `--cycle` flag on `test` automatically dumps aimock's log delta on failure, saving you from running a separate `logs` command after each failed attempt.

**Without the CLI** (the manual equivalent, for understanding what the commands do under the hood):

```sh
cd /path/to/aimock && npm run build
DEPOT_DISABLE=1 docker buildx build --builder desktop-linux --load -t aimock:local .
docker compose -f tests/docker-compose.integrations.yml up -d --force-recreate aimock
sleep 5 && docker logs showcase-aimock 2>&1 | tail -3
```

The CLI version handles the Depot bypass, builder selection, compose file path, and container readiness check automatically.

### Phase 4: Integration Code Fixes

When aimock is behaving correctly but the integration itself has bugs (wrong tool definitions, broken agent wiring, frontend rendering issues):

```sh
# Edit integration source (integrations/<slug>/src/...)
showcase build <slug>           # rebuild the Docker image
showcase recreate <slug>        # pick up the new image
showcase test <slug> --d5 --verbose
```

Or combine build + recreate in one step:

```sh
showcase recreate <slug> --build
```

Use the Playwright UI mode directly (`npx playwright test --ui` from the integration directory) for interactive debugging of frontend issues where the DOM isn't rendering what the probe expects.

### Phase 5: Fixture Iteration

When adding or modifying aimock fixtures (the JSON files that define canned responses):

```sh
# 1. Edit fixture JSON (showcase/aimock/*.json)

# 2. Validate fixtures for common errors (malformed JSON, duplicate keys,
#    missing required fields, turnIndex gaps):
showcase fixtures validate

# 3. Recreate aimock to pick up the changed fixture files:
showcase recreate aimock

# 4. Test:
showcase test <slug> --d5 --verbose
```

Fixtures are baked into the aimock Docker image at build time. Simply editing the JSON file on disk does nothing until the container is recreated with the updated files. This is the most common "why isn't my fix working?" mistake.

### Phase 6: Verify Green

Once you believe the fix is in, run the full probe suite for the slug to confirm everything passes:

```sh
showcase test <slug> --d5 --verbose
# Expected: all probes pass, no timeouts, no fixture mismatches
```

If you want extra confidence, run the test command multiple times to check for flakes.

## Gotchas and Common Mistakes

### restart vs recreate

`docker compose restart` reuses the existing container and image. If you have rebuilt an image, the restarted container still runs the OLD image. This is the single most common source of "I rebuilt but nothing changed."

Always use `showcase recreate` (which runs `docker compose up --force-recreate`) when you need the new image:

```sh
# WRONG -- still uses old image:
docker compose restart mastra

# RIGHT -- picks up new image:
showcase recreate mastra
```

### Depot intercepts Docker builds

On machines with Depot CLI installed, `docker build` is silently proxied through Depot's remote builders. This causes two problems:

1. The `--load` flag may not work as expected (the image stays on the remote builder instead of being loaded locally).
2. Build caching behaves differently, and local filesystem mounts may not resolve.

The `aimock-rebuild` command handles this automatically by setting `DEPOT_DISABLE=1` and using `--builder desktop-linux`.

If you are building manually:

```sh
DEPOT_DISABLE=1 docker buildx build --builder desktop-linux --load -t myimage:local .
```

Run `showcase doctor` to check if Depot is intercepting your builds. The doctor command tests for the Depot shim and warns you if it is active.

### Aimock is stateless; the Responses API is not

The OpenAI Responses API uses `item_reference` to point to previous response items by ID. Aimock does not track conversation state across requests, so it cannot resolve these references dynamically. The synthetic assistant message fix handles this for `turnIndex`-based matching, but other stateful API features (e.g., conversation branching, response chaining by ID) may surface similar issues.

If you see errors about unresolvable item references, the fix is usually to ensure the fixture chain includes all necessary prior-turn context in each response, rather than relying on aimock to remember previous turns.

### Sub-agent calls are independent LLM requests

Each framework's sub-agent (e.g., Mastra's `Agent.generate()`, CrewAI's crew member, LangGraph's tool-calling node) hits aimock as a completely separate HTTP request with a different system prompt and user message. Fixtures for sub-agents must be added explicitly -- they do not inherit from the supervisor's fixture chain.

When debugging multi-agent flows:

1. Use `showcase logs aimock --grep "match"` to see ALL requests, not just the top-level one.
2. Each sub-agent request needs its own fixture with the correct system prompt pattern and turnIndex.
3. The order of sub-agent calls may not be deterministic -- fixtures should be robust to reordering.

### Production vs local aimock behavior

Production aimock uses `--proxy-only`, which silently forwards unmatched requests to real OpenAI. Local aimock returns 404 for unmatched requests. This difference matters:

- **Production can mask missing fixtures** -- the real LLM fills in, and the test may pass by coincidence. You won't know the fixture is incomplete until something changes in the LLM's behavior.
- **Local surfaces fixture gaps immediately** -- 404 errors make missing fixtures obvious. This is a feature, not a bug.
- **Local is the better environment for catching fixture gaps early.** If your test passes locally with all requests matched by fixtures, it will pass in production. The reverse is not guaranteed.

## Workflows by Use Case

### "A D5 probe is failing on CI"

This is the most common debugging scenario. The goal is to reproduce the failure locally, where you have full access to logs and can iterate quickly.

1. `showcase doctor` -- verify your local stack is healthy before chasing red herrings.
2. `showcase up aimock <slug>` -- start the failing integration plus aimock.
3. `showcase test <slug> --d5 --verbose --cycle` -- reproduce the failure locally. The `--cycle` flag dumps aimock logs on failure.
4. `showcase logs aimock --grep "fixture|match"` -- trace what aimock is seeing. Is the fixture matched? Is it the right turnIndex?
5. Fix the issue (fixture, aimock source, or integration code), then:
   - Fixture change: `showcase recreate aimock` then re-test.
   - Aimock source change: `showcase aimock-rebuild --from ~/proj/cpk/aimock` then re-test.
   - Integration code change: `showcase recreate <slug> --build` then re-test.

### "I changed aimock source and need to test it"

The `aimock-rebuild` command handles the full cycle: build the npm package, build the Docker image with Depot bypass, force-recreate the aimock container, and wait for readiness.

```sh
showcase aimock-rebuild --from ~/proj/cpk/aimock
showcase test <slug> --d5 --verbose
```

### "I added a new fixture and it is not being matched"

Fixture matching issues are the most subtle to debug. Work through this checklist:

```sh
# Check for JSON syntax errors, duplicate turnIndex values, missing fields:
showcase fixtures validate

# Recreate aimock to pick up the new fixture file:
showcase recreate aimock

# Watch what aimock is actually matching in real-time:
showcase logs aimock --grep "match"

# Run the test with log dump on failure:
showcase test <slug> --d5 --cycle
```

If the fixture validates and aimock still says "NO match", the request pattern has diverged from what the fixture expects. Compare the logged request (system prompt, model, tools) against the fixture's match criteria.

### "A container is running but returning errors"

```sh
# Check for stale images, port conflicts, missing env vars:
showcase doctor

# Look at recent logs only (skip startup noise):
showcase diff-logs <slug> --since 5m

# Try a fresh container (sometimes state gets corrupted):
showcase recreate <slug>
```

### "I want to see only logs from my last test run"

The test command writes a timestamp marker, and `diff-logs` can use it:

```sh
showcase test <slug> --d5 --verbose      # this writes .last-test-ts
showcase diff-logs aimock --since last-test --grep "fixture"
```

This filters out all log output from before your test started, showing only what happened during the test run itself.

## Isolated Test Runs (`--isolate`)

The `--isolate` flag on `showcase test` lets you run tests without interfering with an already-running local stack (or other isolated runs). It works by creating temporary overlay files rather than mutating originals in place.

### How it works

1. **Temp overlay directory**: `apply_isolation` copies `docker-compose.local.yml` and `shared/local-ports.json` to `$TMPDIR/showcase-isolate-$$/`. The originals are never touched. Shell variables (`COMPOSE_FILE`, `COMPOSE_CMD`, `PORTS_FILE`) and the `LOCAL_PORTS_FILE` env var passed to the TS harness all point at the temp copies.

2. **Slot-based port allocation**: Concurrent `--isolate` runs acquire unique port ranges via atomic `mkdir /tmp/showcase-isolate-slots/N`. Slot 0 adds a +200 offset to all ports, slot 1 adds +400, slot 2 adds +600, etc. Up to 46 concurrent isolated runs are supported. Each slot directory contains a `pid` file for stale-slot detection.

3. **Project name scoping**: Each isolated run passes `--project-name <name>` to docker compose, so containers, networks, and volumes are fully namespaced. No collision with the base `showcase` project or other isolated runs.

4. **Cleanup**: `restore_isolation` removes the temp directory and releases the slot. It is registered via `trap EXIT` before any mutation occurs, so cleanup runs even on crashes or `Ctrl-C`.

### Parallel runs are safe

Multiple agents or terminal sessions can each run `showcase test <slug> --isolate` simultaneously. Each gets its own port range and project namespace. No coordination is needed beyond the atomic slot allocation.

### Troubleshooting

- **Wrong ports / stale compose state**: If you see `.iso-bak` files next to `docker-compose.local.yml` or `shared/local-ports.json`, those are leftovers from the OLD isolate behavior (which mutated files in place). Remove them and restore originals:

  ```sh
  git checkout showcase/docker-compose.local.yml showcase/shared/local-ports.json
  rm -f showcase/docker-compose.local.yml.iso-bak showcase/shared/local-ports.json.iso-bak
  ```

  The new isolate behavior auto-detects and cleans up these stale backups on startup, but a manual restore is the safest fix if things look wrong.

- **Temp files**: Overlay directories live at `$TMPDIR/showcase-isolate-*/`. They are cleaned up on normal exit; if a run was killed with `SIGKILL`, the directory may linger. Safe to remove manually.

- **Slot directories**: Located at `/tmp/showcase-isolate-slots/`. Each numbered subdirectory is a claimed slot. If slots accumulate from killed processes, clean them with `rm -rf /tmp/showcase-isolate-slots/*`.

## Environment Variables

| Variable            | Purpose                                                                            | Default                                                                         |
| ------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `AIMOCK_SRC`        | Path to local aimock checkout for `aimock-rebuild`                                 | `../../aimock` relative to `showcase/` (sibling of repo root), then `../aimock` |
| `SHOWCASE_LOCAL`    | Use localhost ports instead of Railway URLs in the shell app                       | unset                                                                           |
| `DEPOT_DISABLE`     | Bypass Depot CLI for local Docker builds                                           | unset (set to `1` to disable)                                                   |
| `OPENAI_API_KEY`    | Required for all integrations (even with aimock, some init code validates the key) | none                                                                            |
| `ANTHROPIC_API_KEY` | Required for Claude Agent SDK demos                                                | none                                                                            |

## D5 Debugging Strategies

These are investigation techniques — ways to LEARN what's wrong. Each was earned by a real debugging session.

### Strategy 1: Binary classification before single-feature debugging

**When**: Multiple features fail and you don't know why.

**Do**: Run ALL features for the integration and categorize pass/fail. Look for the axis that separates them. Don't debug any single feature until you've found the pattern.

```sh
showcase test <slug> --d5 --verbose 2>&1 | grep "feature-complete"
```

Sort the results into pass/fail. Ask: what do all passing features have in common? What do all failing features share? The spring-ai breakthrough came from noticing: text-only features pass, tool features fail. That one observation eliminated 90% of the search space.

### Strategy 2: Same-endpoint differential

**When**: Two features use the same backend endpoint but one passes and one fails.

**Do**: Find the MOST similar passing feature to your failing one. Diff their request/response flows. The difference IS the bug.

Example: `agentic-chat` and `tool-rendering` both hit the same Java `StreamingToolAgent`. One passes, one fails. The only difference is tool calls. That tells you the bug is in tool event emission, not streaming, not fixture matching, not routing.

### Strategy 3: Bypass the frontend — curl the backend directly

**When**: You can't tell if the problem is frontend rendering or backend response.

**Do**: Hit the backend API directly with the exact request the runtime would send. Compare the raw SSE stream with langgraph-python's.

```sh
# From inside the Docker network:
docker exec showcase-<slug> curl -X POST http://localhost:8000/ \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"weather in Tokyo"}]}'
```

If the raw backend response is correct but the probe fails, the bug is in the frontend/runtime layer. If the backend response is wrong, debug the agent code. This eliminates an entire half of the stack in one command.

### Strategy 4: Message count N→0 means duplicate IDs

**When**: The probe reports `baseline=0, current=0` but you can see the assistant responded (via backend logs or aimock fixture match).

**Do**: Check for duplicate `messageId` values in the AG-UI event stream. React's `deduplicateMessages()` uses a `Map<id, message>`. If a tool result event reuses the assistant message's ID, the map overwrites the assistant message with the tool message — it vanishes from the DOM.

Look at the agent's event emission code. Every event that creates a message needs a unique ID. `UUID.randomUUID()` for each event, never reuse the parent message's ID.

### Strategy 5: Test the gold standard first

**When**: A feature fails and you're about to blame the framework.

**Do**: Run `showcase test langgraph-python --d5` in the SAME environment first. If langgraph-python also fails, the problem is infrastructure (stale aimock, broken fixtures, Docker state), not the framework. This saves hours of framework-specific debugging that turns out to be a shared issue.

```sh
showcase test langgraph-python --d5   # gold standard check
showcase test <slug> --d5             # then your target
```

### Strategy 6: Check custom renderers for missing testids

**When**: `baseline=0, current=0` but the backend is correct AND the SSE stream has correct events.

**Do**: Check if the demo page uses a custom message renderer (`messageView={{ assistantMessage: CustomComponent }}`). Custom renderers that replace `CopilotChatAssistantMessage` must include `data-testid="copilot-assistant-message"` or the probe's selector cascade finds zero messages.

```sh
grep -r "messageView\|assistantMessage" showcase/integrations/<slug>/src/app/demos/
```

### Strategy 7: Trace the full event chain for tool features

**When**: Tool-involving features fail but text-only features pass.

**Do**: Trace each hop in order. Stop at the first broken link.

1. **Aimock** → did the fixture match? `docker logs showcase-aimock | grep "Fixture matched"`
2. **Backend** → did the agent emit correct SSE events? Curl the backend directly (Strategy 3)
3. **Runtime** → did the Next.js server process events without error? `docker logs showcase-<slug> | grep "Error\|ZodError"`
4. **Frontend** → did React render the message? Check for duplicate messageId (Strategy 4) or missing testid (Strategy 6)

Don't skip hops. Don't start at the frontend. Work from the data source (aimock) forward.

### Strategy 8: Production parity — check env vars first

**When**: Feature passes locally but fails in production.

**Do**: Before investigating anything else, verify ALL provider base URLs are set on Railway:

```sh
RAILWAY_PROJECT_ID=6f8c6bff-a80d-4f8f-b78d-50b32bcf4479 \
  railway variables --service showcase-<slug> --json | \
  python3 -c "import json,sys; d=json.load(sys.stdin); \
  [print(f'{k}={v[:40]}') for k,v in sorted(d.items()) if 'BASE_URL' in k or 'AIMOCK' in k]"
```

Missing `ANTHROPIC_BASE_URL` or `GOOGLE_GEMINI_BASE_URL` means the service bypasses aimock and hits the real API. This produces non-deterministic results that look like flapping. Local docker-compose sets ALL providers to aimock — production must match.

### Strategy 9: Pull PocketBase D5 history to distinguish bugs from flapping

**When**: Production shows blues (D4) but everything passes locally. You need to know if a feature is genuinely broken or just flapping from transient production conditions.

**Do**: Pull the current D5 status records from PocketBase in one request and categorize the errors. PocketBase stores ONE record per `d5:<slug>/<featureType>` key (upsert), with `fail_count` tracking consecutive failures.

```sh
# Get ALL currently-red D5 records with error details:
curl -s 'https://showcase-pocketbase-production.up.railway.app/api/collections/status/records?sort=-updated&perPage=200&filter=key~%22d5:%22%20%26%26%20state!=%22green%22' | \
  python3 -c "
import json, sys
data = json.load(sys.stdin)
items = data.get('items', [])
print(f'{len(items)} RED D5 records')
for item in items:
    key = item.get('key', '?').replace('d5:showcase-','')
    fc = item.get('fail_count', 0)
    signal = item.get('signal', {})
    error = signal.get('errorDesc', '') if isinstance(signal, dict) else ''
    print(f'{key:<50} fc={fc:<3} {error[:80]}')
"
```

**How to read it:**

- `fail_count=1` → just flipped red on the last cycle (likely flapper)
- `fail_count>=3` → consistently failing (likely a real bug)
- `fail_count=0` with `state!=green` → transitional state, check again next cycle

**Categorize errors** to find the root cause pattern:

- `page.fill: Timeout` → React hydration too slow (probe infrastructure issue)
- `assistant did not respond within 30000ms` → backend or aimock not returning
- `chat input not found` → selector cascade failed (page didn't render)
- `keyword missing` → aimock returned wrong fixture
- `auth: after clicking sign-out` → auth probe timing race

**Cross-reference with deploy history** to identify deploy churn:

```sh
gh run list --branch main --limit 10 -R CopilotKit/CopilotKit --workflow "Showcase: Build & Push"
```

If a feature flipped red right when a deploy happened and `fail_count=1`, it's deploy churn — the Railway service restarted mid-probe. Wait one cycle and re-check.

**Get per-service flapping rates** from the harness API (last 10 probe runs):

```sh
curl -s 'https://showcase-harness-production.up.railway.app/api/probes/probe:e2e-deep' | \
  python3 -c "
import json, sys
data = json.load(sys.stdin)
runs = [r for r in data.get('runs', []) if r.get('state') == 'completed' and r.get('summary')][:10]
stats = {}
for run in runs:
    for svc in run['summary'].get('services', []):
        slug = svc.get('slug','?').replace('e2e-deep:showcase-','')
        result = svc.get('result', '?')
        stats.setdefault(slug, {'green': 0, 'red': 0})
        stats[slug]['green' if result == 'green' else 'red'] += 1
for slug in sorted(stats):
    s = stats[slug]
    rate = s['green'] / (s['green'] + s['red']) * 100
    print(f'{slug:<25} {s[\"green\"]}/{s[\"green\"]+s[\"red\"]} green ({rate:.0f}%)')
"
```

**Key insight**: If ALL integrations flap at similar rates (50-70% green), the problem is systemic (probe infrastructure), not per-integration code bugs. If only one integration is consistently red while others are green, it's a real code bug in that integration.

## Quick Diagnostic Commands

```sh
# Is everything OK?
showcase doctor

# What's running?
showcase ps

# What port is mastra on?
showcase ports | grep mastra

# Show aimock's fixture matching in real-time:
showcase logs aimock --grep "fixture|match|NO match"

# Last 5 minutes of error logs:
showcase diff-logs <slug> --since 5m --grep "error|Error|ERR"

# Validate all fixture files:
showcase fixtures validate

# Full reset -- stop everything, rebuild, restart:
showcase down
showcase build <slug>
showcase up aimock <slug>
showcase test <slug> --d5 --verbose
```
