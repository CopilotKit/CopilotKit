# QA: Agentic Generative UI (OpenClaw)

Demo source: `src/app/demos/gen-ui-agent/page.tsx`
Route: `/demos/gen-ui-agent` · Agent: `gen-ui-agent`

## What it exercises

An agent working a long-running, multi-step task while a single **task-progress
card** renders live inside the chat transcript. The frontend subscribes to the
agent's `steps` state via `useAgent` (v2, `OnStateChanged`) and renders one
`InlineAgentStateCard` in place through `messageView.children` — the card
updates as state arrives, rather than one card per message. Each step carries a
status (`pending` → `in_progress` → `completed`); the card shows a headline
("Step N of M" / "All N steps complete"), per-step markers, and a spinner while
running.

## OpenClaw reality (read before testing)

OpenClaw is a **single stateless gateway** (ag-ui operator route) with no
per-demo backend graph. The canonical demo expects a backend agent that owns a
`steps` state schema and mutates it via a `set_steps` tool, streaming each update
to the client as a `STATE_SNAPSHOT`. On OpenClaw that streamed state is produced
by the ag-ui **state-writer** capability (declared via
`forwardedProps.stateWriterTools`) — the same mechanism the shared-state demos
use.

This demo page does **not** declare any state-writer tools of its own; it only
reads `agent.state.steps`. So the progress card only populates if the gateway
emits `steps` state for the run. Treat live step streaming here as **best-effort
/ not individually e2e-verified** (see PARITY_NOTES: gen-ui-agent is listed
under supported tools & generative UI, but the verified-at-gateway list covers
shared-state-read-write, not this demo). Test against the real backend and record
what actually happens.

## Manual steps

Against the real backend at `http://localhost:3119/demos/gen-ui-agent`:

1. Open the demo. Confirm the chat loads in a centered, full-height layout and
   the composer renders.
2. Confirm the three suggestion chips are visible: **Plan a product launch**,
   **Organize a team offsite**, **Research a competitor**.
3. Click **Plan a product launch** (or type "Plan a product launch for a new
   mobile app.").
4. Expect: the agent starts working and a single progress card
   (`data-testid="agent-state-card"`) appears in the transcript once `steps`
   state arrives.
5. As the run proceeds, expect steps (`data-testid="agent-step"`) to appear and
   their status to advance — completed steps show a green check + strikethrough,
   the active step shows a spinner marker, pending steps show a numbered marker.
   The headline updates from "Planning…" → "Step N of M" → "All N steps
   complete".
6. Confirm exactly **one** card renders (not one per state-changing message), and
   it updates in place.

## Assertion bar

- Exactly one `agent-state-card` in the transcript; it updates in place.
- Steps advance through `pending` → `in_progress` → `completed`; the headline and
  spinner/check reflect the current state.
- The agent produces a coherent textual answer alongside the card.
- No duplicate cards, no console errors, no broken layout.

## Known caveats

- **State streaming is gateway-dependent.** If the OpenClaw run does not emit
  `steps` state, the card never appears even though the agent replies in text.
  This is expected given the stateless-gateway architecture and the fact that
  this page declares no `stateWriterTools`. Note it in results rather than
  treating a text-only reply as a hard failure.
- The `set_steps` tool / `steps: list[Step]` schema referenced in the source
  comments describes the canonical Python deep-agent backend, which OpenClaw does
  not run. On OpenClaw the equivalent state must come from the ag-ui
  state-writer path.

## Protocol-level check (no browser)

Inside the running container, POST a `RunAgentInput` for a multi-step planning
prompt to `http://127.0.0.1:8000/v1/ag-ui/operator` (Bearer gateway token,
`Accept: text/event-stream`) and inspect the SSE stream: confirm whether any
`STATE_SNAPSHOT` (or `STATE_DELTA`) events carrying a `steps` array are emitted
before `RUN_FINISHED`. Their presence/absence tells you directly whether the
progress card can populate for this demo.
