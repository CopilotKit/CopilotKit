# `_parity/` — integration-demo parity tooling

Keeps `examples/integrations/*` demos aligned to a single north-star so
drift doesn't pile up as the canonical demo evolves.

**North-star (v1):** `langgraph-python` — the richest demo (todos state, 5
tools, polished prompt, full frontend canvas). Every other integration demo
should track it.

## What gets tracked

Declared in [`manifest.json`](./manifest.json):

- **verbatim files** — copied byte-for-byte from north-star to each instance
  (frontend components, hooks, lib, public assets, shared Docker files,
  `docker-compose.test.yml`, `entrypoint.sh`, `postcss.config.mjs`, etc.)
- **package.json keys** — tracked dependency versions and script names
  (`@copilotkit/*`, `next`, `react`, shared dev scripts). Per-instance
  overrides in manifest (`packageJsonOverrides`) win where the instance
  legitimately differs (e.g. `dev:agent` runs `npm install` in JS but
  `uv sync` in FastAPI).
- **canonical prompt** — `_parity/canonical/PROMPT.md`. Each agent
  **inlines** the prompt as a string literal in its source (matching the
  north-star's `main.py` pattern). Verifier greps the canonical prompt's
  first non-blank line against instance agent source — drift = error.
- **agent surface** — tool names + state keys expected to appear in each
  instance's agent source. Grep-level check — doesn't validate call-site
  correctness, that's the aimock fixture tests' job.

## What doesn't get tracked (allowed divergence)

Per-instance `allowedDivergence` list in `manifest.json`:

- `agent/**` — agents are written in different languages/runtimes (Python
  create_agent, TS StateGraph, Python StateGraph+FastAPI). Human-authored.
- `src/app/api/copilotkit/**` — north-star uses `LangGraphAgent`, Docker
  instances use `HttpAgent`. Different routes.
- `Dockerfile`, `docker/Dockerfile.agent`, `serve.py`, `scripts/**` —
  language-specific build/run tooling.

Anything outside both `tracked` and `allowedDivergence` is "no-op" — the
verifier neither checks nor touches it.

## Commands

From the repo root:

```bash
# Sync a single instance to north-star (copies verbatim files, rewrites
# package.json keys, writes canonical prompt to agent/PROMPT.md)
pnpm parity:sync --target=langgraph-js

# Dry-run: show what would change without writing
pnpm parity:sync --target=langgraph-js --dry-run

# Sync every non-north-star instance
pnpm parity:sync --all

# Verify — exits non-zero on unexpected drift
pnpm parity:verify
pnpm parity:verify --target=langgraph-js

# CI invocation (same as verify, no color)
pnpm parity:check
```

## Typical workflows

### North-star changed — sync instances

```bash
pnpm parity:sync --all
pnpm parity:verify
# fix any agent-surface drift manually in the relevant agent/src/ files
git add . && git commit
```

### Adding a new instance

1. Create the new demo under `examples/integrations/<name>/` with a
   Next.js frontend at the root and an `agent/` dir.
2. Add an entry to `manifest.json` under `instances`:
   ```json
   "new-demo": {
     "role": "instance",
     "agent": { "language": "python", "runtime": "..." },
     "allowedDivergence": ["agent/**", "src/app/api/copilotkit/**",
                          "Dockerfile", "docker/Dockerfile.agent",
                          "serve.py", "scripts/**"],
     "packageJsonOverrides": { "scripts.dev:agent": "..." }
   }
   ```
3. Run `pnpm parity:sync --target=new-demo`.
4. Hand-port the agent code (tools, state, prompt loading) — manifest
   `tracked.agentSurface` tells you what tool names and state keys are
   required.
5. Run `pnpm parity:verify --target=new-demo` until green.

### North-star's agent surface changed

Edit `manifest.json` → `tracked.agentSurface.toolNames` / `stateKeys`.
The verifier will then flag every instance that hasn't caught up.

### Canonical prompt changed

1. Edit `_parity/canonical/PROMPT.md`.
2. Update north-star's `agent/main.py` to use the new prompt string
   (north-star is where humans read; canonical file is what the
   verifier reads).
3. Port the new prompt into every instance's agent source (same
   manual-merge rules as any agent change).
4. `pnpm parity:verify` — verifier greps first line of canonical against
   each instance's agent source. Passes when all instances inline it.

## CI

`.github/workflows/integrations_parity.yml` runs `pnpm parity:check` on
every PR that touches `examples/integrations/**`. Failures link the
contributor back to this README.

## Design notes

- **Declarative, not prescriptive.** The manifest says _what_ is tracked;
  the scripts just walk it. Adding a new tracked file = one line change,
  not a code change.
- **Allowed-divergence is explicit, not implicit.** Everything is either
  tracked, declared-divergent, or ignored — no silent "probably different"
  state.
- **Agent surface is grep-level, on purpose.** A real AST check would be
  three times the code and still miss semantic drift. The existing aimock
  fixture integration tests (under `fixtures/default.json` per instance)
  are the real correctness check; this is the "did someone rip out
  `manage_todos`" safety net.
- **North-star is read-only to the scripts.** `sync.ts` refuses to write
  into the north-star directory even if asked. Verifier never touches
  anything.
