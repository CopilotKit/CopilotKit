# QA: Pre-Built Popup (OpenClaw)

Demo source: `src/app/demos/prebuilt-popup/page.tsx`
Route: `/demos/prebuilt-popup` · Agent: `prebuilt-popup`
Run against the real backend at `http://localhost:3119/demos/prebuilt-popup`.

Status: **supported** (chat / presentation — see `PARITY_NOTES.md`).

## What it exercises

The pre-built `<CopilotPopup />` component: a floating launcher bubble that
opens an overlay chat above the page while the underlying layout keeps its
shape. This is a presentation demo — it wires the popup to the gateway and
proves plain conversational chat works through it. There are **no tools, no
shared state, and no generative UI** on this page.

OpenClaw is a single stateless gateway with no per-demo backend, so the
`prebuilt-popup` agent id maps to the same pass-through endpoint as every other
demo (see the `agentNames` list in `src/app/api/copilotkit/route.ts`). Each
turn is a fresh `RunAgentInput` → SSE run; assistant text streams back as
`TEXT_MESSAGE_*` events. Three "always" suggestion chips are configured via
`useConfigureSuggestions` (Say hi / Limerick / Is 17 prime?).

## Prerequisites

- Stack is up; demo reachable at the URL above.
- Gateway is healthy (per-demo agent names all map to the one OpenClaw endpoint;
  `GET /api/copilotkit` reports `gateway_status: reachable`).

## Manual steps

1. Open the demo. Confirm the main content renders — heading **"Popup demo"**
   with the `<CopilotPopup />` explainer copy — and that the popup opens
   **automatically** (`defaultOpen={true}`), with a floating launcher bubble in
   the corner.
2. Confirm the chat input placeholder reads **"Ask the popup anything..."**.
3. Confirm the three suggestion chips are visible: **Say hi**, **Limerick**,
   **Is 17 prime?**.
4. Click **Say hi** (or type "Say hi from the popup!"). Expect the agent to
   stream back a short greeting.
5. Click **Is 17 prime?**. Expect a coherent multi-step answer concluding 17 is
   prime — confirms streamed text over multiple turns in the same session.
6. Click the launcher to **close** the popup, then re-open it. Confirm the
   prior messages are still shown (chat state persists across open/close).

## Assertion bar

- Popup opens on page load without a click; launcher bubble visible in the
  corner.
- The agent responds with streamed text (typically within ~10s); no tool cards,
  no state panels — this demo is chat only.
- Closing and re-opening the popup preserves the transcript.
- No console errors and no broken/overlapping layout during normal use.

## Protocol-level check (no browser)

Inside the running container, POST a plain-chat `RunAgentInput` (a single user
message, empty `tools`) to
`http://127.0.0.1:8000/v1/ag-ui/operator` (Bearer gateway token,
`Accept: text/event-stream`) and confirm the SSE contains `TEXT_MESSAGE_START`
→ `TEXT_MESSAGE_CONTENT` (streamed) → `TEXT_MESSAGE_END`, then `RUN_FINISHED`.

## Caveats

- The popup is the only visible chat surface — there is no sidebar on this page.
- Nothing here is popup-specific at the protocol level: the popup is a UI shell
  over the same pass-through chat that backs the other presentation demos
  (`prebuilt-sidebar`, `headless-simple`). If plain chat regresses, it regresses
  everywhere, not just here.
