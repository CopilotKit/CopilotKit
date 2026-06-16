# Built-in Agent — Parity Notes

This integration now uses the LangGraph Python product demo frontends as the
canonical UI source. The following paths are expected to remain byte-for-byte
with `showcase/integrations/langgraph-python` unless a backend-specific
exception is documented here:

- `src/app/demos`
- `src/components/ui`
- `src/lib/utils.ts`
- `src/app/globals.css`
- `public/demo-files`
- `public/demo-audio`

Run `npm run test:frontend-parity` in this package to verify that contract.

## Backend Contract

The copied frontends keep the LangGraph Python agent IDs and route names. The
built-in runtime registers those IDs as aliases rather than rewriting the UI:

- `/api/copilotkit` handles the default chat/tool/state demos plus the
  reasoning demos.
- Dedicated routes cover Beautiful Chat, A2UI, Open Generative UI, MCP Apps,
  auth, voice, multimodal, agent config, HashBrown, and json-render.
- Most demos use `createBuiltInAgent`; feature-specific factories live under
  `src/lib/factory/`.

All built-in-agent OpenAI chat factories resolve through
`src/lib/factory/models.ts`, which defaults to GPT-5.4.

## Unsupported Features

`manifest.yaml` marks only architectural gaps as `not_supported_features`.
These IDs must not also appear in `features`, because the registry generator
treats those sets as mutually exclusive.

- `shared-state-streaming` — the frontend is present, but built-in-agent does
  not yet have a dedicated per-token document writer equivalent to the
  LangGraph streaming-state agent.
- `gen-ui-interrupt` and `interrupt-headless` — the copied frontends are wired,
  but the built-in agent has no native LangGraph-style interrupt primitive.

The dashboard and D6 harness should treat these as unsupported cells, not
regressions.

## Generated Docs

`manifest.yaml` uses `docs_mode: generated`. Highlights point at existing
built-in-agent frontend files plus TypeScript route/factory files, and the
bundler extracts `// @region[...]` blocks where available.

## When to update this file

- Adding a Strategy-B adaptation → document the primitive substitution here.
- Adding a per-demo UI divergence vs. LGP → document the rationale.
- Lifting a manifest quarantine → remove the corresponding entry above and
  flip `not_supported_features` in `manifest.yaml` in the same commit.
- Adding an NSF banner → list the demo + testid here.
