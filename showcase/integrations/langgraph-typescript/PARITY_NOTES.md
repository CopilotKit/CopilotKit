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
- **a2ui-recovery** (`recovery-agent.ts`) adds `wrapModelCall` / `wrapToolCall`
  header-forwarding middleware (ALS + custom OpenAI `fetch`) that LGP does not
  need. Reason: the TS `@ag-ui/langgraph` `getA2UITools` invokes its inner
  `render_a2ui` sub-agent via a CONFIG-LESS `model.stream(...)`, so the usual
  config-based `makeChatOpenAI` forwarding can't reach it; without forwarding
  the inner render's aimock call carries no `x-test-id`, its `sequenceIndex`
  state falls into the never-reset `DEFAULT_TEST_ID` bucket, and the heal
  fixture's seq0->seq1 staging only works on the first run (flaky thereafter).
  The middleware forwards the inbound `x-*` headers onto every outbound OpenAI
  call — outer emit AND inner render — so each harness run gets its own
  per-`x-test-id` sequence bucket. Also: the heal/exhaust pill prompts +
  `aimock/d6/langgraph-typescript/a2ui-recovery.json` `userMessage` keys are
  langgraph-typescript-UNIQUE (mirror `d5-a2ui-recovery.ts` PROMPTS) — the
  recovery fixtures carry no `x-aimock-context`, so a per-slug-unique prompt is
  load-bearing to avoid cross-framework fixture collisions.

## Not-supported (NSF) cells

- **gen-ui-interrupt**, **interrupt-headless** — QUARANTINED on a shared
  upstream `@copilotkit/react-core/v2` `useInterrupt`/`useHeadlessInterrupt`
  resume-path bug: the backend resumes + streams (HTTP 200) but the frontend
  never appends the confirmation bubble, so the harness DOM settle-check times
  out. Red/NSF on the langgraph-python north star too — not a regression here.

## Known behavioral divergence (green, but not byte-behavior-identical to LGP)

- **reasoning-display** (reasoning-custom / reasoning-default) — GREEN, but the
  reasoning summary does NOT stream token-by-token as it does on
  langgraph-python. Cause: `@langchain/openai@1.4.4`'s streaming Responses
  converter pushes the reasoning-summary delta and the answer output_text delta
  to the same content-block index (both index 0), so the streaming reducer
  collapses them and the answer is swallowed into the reasoning block (the D6
  probe then reds with `text-unstable`). Workaround: `disableStreaming: true` in
  `src/agent/reasoning-agent.ts` forces the non-streaming converter, which
  yields a correct reasoning block + a separate answer block. Net: reasoning +
  answer render correctly (matching LGP's content), but arrive at once rather
  than streamed. Revisit / remove `disableStreaming` when the upstream
  `@langchain/openai` index-collision bug is fixed.

All other declared cells are GREEN (verified via aimock D6 with the dedicated
graph running, not the generic `sample_agent`/`starterAgent` fallback).
