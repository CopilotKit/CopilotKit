# QA: Frontend Tools (OpenClaw)

Demo source: `src/app/demos/frontend-tools/page.tsx`
Route: `/demos/frontend-tools`  ·  Agent: `frontend-tools`

## What it exercises

A tool (`change_background`) defined in React with `useFrontendTool`, executed in
the browser, and invoked by the OpenClaw agent. The schema is forwarded over
AG-UI in `RunAgentInput.tools`; the clawg-ui adapter hands it to OpenClaw as a
caller-provided **client tool** (via `runtime.agent.runEmbeddedAgent({ clientTools })`),
so the model can call it. When the model calls it, the run stops with a pending
tool call, clawg-ui emits `TOOL_CALL_START/ARGS/END`, and the page handler runs
locally to change the background.

## Manual steps

1. Open the demo. Confirm the chat composer renders and the page background is
   the default.
2. Ask: **"Change the background to a blue-to-purple gradient."**
3. Expect: the agent calls `change_background`, the tool card shows success, and
   the **full page background** changes to the requested gradient.
4. Follow up: **"Now make it a sunset gradient."** Confirm the background updates
   again (the round-trip — tool result fed back — continues coherently).

## Assertion bar

- The page background actually changes (not just a "success" message).
- Exactly one tool-call sequence per request (no duplicate render).
- The response after the tool result is coherent and references the change.

## Protocol-level check (no browser)

Inside the running container, POST a `RunAgentInput` carrying a `change_background`
tool to `http://127.0.0.1:8000/v1/clawg-ui/operator` (Bearer gateway token,
`Accept: text/event-stream`) and confirm the SSE contains a single
`TOOL_CALL_START` for `change_background` with the expected args, then
`RUN_FINISHED`.
