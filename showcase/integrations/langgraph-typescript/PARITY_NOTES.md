# langgraph-typescript — Parity Notes

North star: `showcase/integrations/langgraph-python`. This integration ships the
**same demo frontends and the same demo set**, tested identically. The frontend
is byte-identical to langgraph-python except the sanctioned divergences below;
the backend is a native TypeScript (`@langchain/langgraph`) port.

## Sanctioned divergences from langgraph-python

### Identity (expected for every non-reference integration)
- `manifest.yaml` header: `name`, `slug`, `language: typescript`, `logo`,
  `description`, `repo`, `sort_order: 11`.
- `manifest.yaml` `demos[].highlight` **backend** paths point at the TypeScript
  graphs (`src/agent/*.ts`) instead of the Python agents (`src/agents/*.py`).
  Frontend + API-route highlight paths are unchanged (byte-identical).
- `cli-start` command: `--framework langgraph-typescript`.
- `src/app/demos/layout.tsx` + `src/app/layout.tsx`: the page-title strings and
  the dev diagnostic console string read "LangGraph (TypeScript)" instead of
  "(Python)". Everything else in those files is byte-identical.

### Backend is TypeScript (language port, not a behavior change)
- Every graph is a TS port under `src/agent/*.ts` registered in
  `src/agent/langgraph.json`; the CopilotKit runtime routes are TS
  (`src/app/api/**/route.ts`). Agent **names** the frontend passes
  (`<CopilotKit agent="...">`) are identical to langgraph-python; only the
  graphId behind each name differs.
- Reasoning demos (`reasoning-custom`, `reasoning-default`) run the
  `reasoning-agent.ts` graph, which surfaces reasoning tokens via the OpenAI
  Responses API (Python uses `deepagents`; there is no drop-in TS equivalent).
  Behavior/rendering is equivalent. Frontend comments copied verbatim from
  langgraph-python still name the Python graph — cosmetic only.
- `dedicated` API routes use a trailing-slash `deploymentUrl` (required for the
  langgraph-typescript adapter — see `showcase/GOTCHAS.md`).

## Not-supported (NSF) cells

- **gen-ui-interrupt**, **interrupt-headless** — QUARANTINED on a shared
  upstream `@copilotkit/react-core/v2` `useInterrupt`/`useHeadlessInterrupt`
  resume-path bug: the backend resumes + streams (HTTP 200) but the frontend
  never appends the confirmation bubble, so the harness DOM settle-check times
  out. Red/NSF on the langgraph-python north star too — not a regression here.

All other declared cells are GREEN (verified via aimock D6 with the dedicated
graph running, not the generic `sample_agent`/`starterAgent` fallback).
