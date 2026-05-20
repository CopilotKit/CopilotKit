---
name: copilotkit-demo-parity
description: Keeps examples/integrations/* demos aligned to the north-star (langgraph-python). Use when the user says "sync demos", "sync integrations", "port to north-star", "align integration demos", "parity check", or when working inside examples/integrations/ and tracked files diverge. Drives the pnpm parity:sync / parity:verify commands and handles the manual-merge zones (agent code, api route, Dockerfile).
---

# CopilotKit demo parity

Keeps the three (soon more) integration demos under `examples/integrations/`
aligned. `langgraph-python` is north-star; every other entry is an instance
that tracks it via `examples/integrations/_parity/manifest.json`.

## When this skill fires

- User says "sync demos", "align integrations", "port to north-star",
  "parity check", "run parity sync".
- User edits a file under `examples/integrations/langgraph-python/**` that is
  listed in `manifest.json` → tracked.verbatimFiles.
- User is about to add a new integration under `examples/integrations/`.
- `pnpm parity:verify` is failing locally or in CI.

## Ground truth

Read these first before making any parity decision — they override
anything memorized:

- `examples/integrations/_parity/manifest.json` — what is tracked, what is
  allowed to diverge, per-instance overrides.
- `examples/integrations/_parity/canonical/PROMPT.md` — the canonical
  system prompt. Every agent inlines this as a string literal in source.
  The verifier greps the canonical first line against each agent's source.
- `examples/integrations/_parity/README.md` — human-facing how-to.

## Procedure: sync from north-star to instance(s)

Use when north-star changed and instances need to catch up, OR when a new
instance is being bootstrapped.

1. **Confirm the north-star change is intentional.** If the user changed
   a file under `langgraph-python/`, ask whether it should propagate.
   Changes to `agent/` are never auto-propagated.
2. **Dry-run first.**
   ```bash
   pnpm parity:sync --target=<instance> --dry-run
   ```
   Read the report: file count, rewritten package.json keys, prompt update.
3. **Apply.**
   ```bash
   pnpm parity:sync --target=<instance>
   # or --all to sync every instance
   ```
4. **Resolve manual-merge zones.** Sync does NOT touch:
   - `agent/**` — port agent code by hand. See `tracked.agentSurface.toolNames`
     and `stateKeys` in `manifest.json` for what must be present.
   - `src/app/api/copilotkit/**` — api route differs across instances
     (north-star=LangGraphAgent, Docker instances=HttpAgent).
   - `Dockerfile`, `docker/Dockerfile.agent`, `serve.py`, `scripts/**` —
     language-specific. Each instance keeps its own.
5. **Verify.**
   ```bash
   pnpm parity:verify --target=<instance>
   ```
   Exit 0 = green. Exit 1 = unresolved drift; fix until green.

## Procedure: verify (CI-equivalent)

```bash
pnpm parity:verify             # all instances
pnpm parity:verify --target=<instance>
pnpm parity:verify --json      # machine-readable
```

Output kinds:

- `verbatim-file` — byte-compare against north-star.
- `package-json` — tracked key mismatch vs expected value.
- `prompt` — canonical prompt first line not found in instance agent
  source. Instance agent needs the prompt inlined as a string literal.
- `agent-tool` — tool name from manifest not found in instance agent
  source. Usually means a tool was renamed or dropped; update manifest
  OR port the tool.
- `agent-state` — state key from manifest not found (warn only).

## Procedure: add a new instance

1. Create the demo dir under `examples/integrations/<name>/` with the
   usual Next.js frontend root and an `agent/` subdir.
2. Add an entry to `manifest.json` → `instances`:
   ```json
   "<name>": {
     "role": "instance",
     "agent": { "language": "...", "runtime": "..." },
     "allowedDivergence": [
       "agent/**",
       "src/app/api/copilotkit/**",
       "Dockerfile",
       "docker/Dockerfile.agent",
       "serve.py",
       "scripts/**"
     ],
     "packageJsonOverrides": {
       "scripts.dev:agent": "<invocation>",
       "scripts.install:agent": "<install>"
     }
   }
   ```
3. `pnpm parity:sync --target=<name>`
4. Port agent code (tool implementations, state schema, prompt loading).
   Agent must read prompt from `agent/PROMPT.md` at startup.
5. `pnpm parity:verify --target=<name>` until green.

## Procedure: change the canonical prompt

1. Edit `examples/integrations/_parity/canonical/PROMPT.md`.
2. `pnpm parity:sync --all` — writes the new prompt to every instance's
   `agent/PROMPT.md`.
3. If the prompt change requires new tools or state keys, update
   `manifest.json` → `tracked.agentSurface` to match, then port each
   instance's agent.

## Procedure: change the tracked surface

To track a new file or key:

1. Edit `manifest.json` → `tracked.verbatimFiles` or `tracked.packageJsonPaths`.
2. Run `pnpm parity:verify` — instances will flag as drifted until synced.
3. `pnpm parity:sync --all` to apply.

To stop tracking something, remove it from `manifest.json`. The verifier
and sync stop touching it. Any drift that already exists stays.

## Red flags

| Signal                                          | What it means         | Do instead                                      |
| ----------------------------------------------- | --------------------- | ----------------------------------------------- |
| "Just copy the file manually"                   | Bypasses the manifest | Add to `tracked.verbatimFiles` then sync        |
| "Add a try/catch so verify doesn't fail"        | Silencing drift       | Resolve the drift or declare divergence         |
| "Move this into `allowedDivergence` to unblock" | Scope creep           | Only add to divergence with explicit reason     |
| `pnpm parity:sync` on north-star directly       | Overwrites canonical  | Sync is instance-only; script refuses           |
| Agent code copied between languages             | Doesn't work          | Port by hand; `tracked.agentSurface` names what |

## Related skills

- `copilotkit-integrations` — framework-specific wiring (LangGraph, CrewAI,
  Mastra, etc.) when bootstrapping a new instance.
- `copilotkit-dev-workflow` — monorepo conventions, Nx, commit format.
- `docker-ci-safety` — Dockerfile safety when editing per-instance
  container builds.
