# QA: Frontend Tools (OpenClaw)

Demo source: `src/app/demos/frontend-tools/page.tsx`
Route: `/demos/frontend-tools` · Agent: `frontend_tools`
Run against the real backend at `http://localhost:3119/demos/frontend-tools`.

Status: **supported**, and verified end-to-end at the gateway level (see
`PARITY_NOTES.md`).

## What it exercises

A single tool (`change_background`) defined in React with `useFrontendTool`,
executed in the browser, and invoked by the OpenClaw agent. It takes one string
arg, `background` — any valid CSS background value (colors, linear/radial
gradients) — and its handler calls `setBackground(...)`, restyling the full-page
`Background` container.

OpenClaw is a single stateless gateway with no per-demo backend, so the tool is
**frontend-forwarded**: its schema rides over AG-UI in `RunAgentInput.tools`,
the ag-ui adapter hands it to OpenClaw as a caller-provided **client tool**
(`runtime.agent.runEmbeddedAgent({ clientTools })` — the only tool list the
gateway exposes to the model). When the model calls it, the run stops on a
pending tool call, ag-ui emits `TOOL_CALL_START/ARGS/END`, and the page
handler runs locally to change the background.

## Prerequisites

- Stack is up; demo reachable at the URL above.
- Gateway is healthy (per-demo agent names all map to the one OpenClaw endpoint).

## Manual steps

1. Open the demo. Confirm the `CopilotSidebar` renders (open by default) and the
   page background is the default **solid indigo** (`#4f46e5`).
2. Ask: **"Change the background to a blue-to-purple gradient."**
3. Expect: the agent calls `change_background`, the tool card shows success, and
   the **full page background** transitions to the requested gradient.
4. Follow up: **"Now make it a sunset gradient."** Confirm the background updates
   again — the tool result is fed back and the conversation continues coherently.
5. (Optional) Click a suggestion chip — **Sunset theme**, **Forest theme**, or
   **Cosmic theme** — and confirm it sends the message and drives the same tool.

## Assertion bar

- The page background actually changes (not just a "success" message). You can
  confirm the applied value on the `data-testid="frontend-tools-background"`
  element's `data-background-value` attribute.
- Exactly one tool-call sequence per request (no duplicate render).
- The response after the tool result is coherent and references the change.

## Protocol-level check (no browser)

Inside the running container, POST a `RunAgentInput` carrying a
`change_background` tool to `http://127.0.0.1:8000/v1/ag-ui/operator`
(Bearer gateway token, `Accept: text/event-stream`) and confirm the SSE contains
a single `TOOL_CALL_START` for `change_background` with the expected args, then
`RUN_FINISHED`.

## Caveats

- The handler only calls `setBackground` and always returns
  `{ status: "success" }` — it does not validate the CSS, so a malformed value
  from the model renders as-is (the browser ignores an invalid background).
- Behaviour comes from the frontend + ag-ui client-tools path, not a per-demo
  backend graph — the same mechanism backs the other frontend-tool demos.
