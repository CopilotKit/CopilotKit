# QA: In-App Human in the Loop (OpenClaw)

Demo source: `src/app/demos/hitl-in-app/page.tsx`
Route: `/demos/hitl-in-app` · Agent: `hitl-in-app`
Run against the real backend at `http://localhost:3119/demos/hitl-in-app`.

Status: **supported** — tool-based, promise/`respond()` HITL (the fleet's
`promise-based` pattern; see `PARITY_NOTES.md`). This is _not_ LangGraph-native
`interrupt()`; OpenClaw is a gateway, not a graph engine, so the pause lives in
the frontend tool handler, not the backend.

## What it exercises

A single approval tool, `request_user_approval`, defined in React with
`useFrontendTool`. Its handler returns a `Promise` and stashes the `resolve`
function into page state, then opens an **app-level modal** (`ApprovalDialog`,
portal'd to `<body>` — outside the chat surface). The user clicks Approve or
Reject (optionally adding a note); that click calls `resolve(...)`, which
completes the handler and hands `{ approved, reason? }` back to the agent as the
tool result. The agent then continues, acknowledging the decision.

The tool takes `message` (short summary of the action) and optional `context`
(e.g. a ticket ID). A left-hand `TicketsPanel` renders three hard-coded support
tickets so the agent has real-looking data to act on.

OpenClaw is a single stateless gateway with no per-demo backend, so the tool is
**frontend-forwarded**: its schema rides over AG-UI in `RunAgentInput.tools`,
the ag-ui adapter hands it to OpenClaw as a caller-provided **client tool**
(the only tool list the gateway exposes to the model). When the model calls it,
the run stops on a pending tool call and the page handler runs locally, blocking
on the modal until the operator decides.

## Prerequisites

- Stack is up; demo reachable at the URL above.
- Gateway is healthy (per-demo agent names all map to the one OpenClaw endpoint).

## Manual steps

1. Open the demo. Confirm the **Support Inbox** panel renders three tickets
   (#12345 Jordan Rivera, #12346 Priya Shah, #12347 Morgan Lee) and the
   `CopilotPopup` chat renders (open by default).
2. Click the **"Approve refund for #12345"** suggestion chip (or type the same
   request).
3. Expect: the agent calls `request_user_approval`, and the approval dialog
   (`data-testid="approval-dialog"`) appears as a **portal'd app-level modal**
   over the page — not inside a chat bubble. The heading shows the action
   summary (refund amount + customer); the context box shows the ticket detail.
4. Click **Approve**. Confirm the dialog closes and the agent's reply
   acknowledges the approval and (conceptually) proceeds with the action.
5. Repeat with a different suggestion (e.g. **"Downgrade plan for #12346"**),
   this time clicking **Reject**. Confirm the dialog closes and the agent
   acknowledges the rejection instead of proceeding.
6. Repeat once more, but before clicking, type a note in the **Note (optional)**
   textarea (`data-testid="approval-dialog-reason"`). Confirm the agent's reply
   reflects the note (it is returned as `reason` in the tool result).

## Assertion bar

- The dialog renders as a modal on top of the page (portal to `<body>`), not
  within the chat transcript.
- The agent **waits** on the operator's decision before continuing — no reply
  text between the tool call and the button click.
- Approve vs Reject produce distinct, coherent follow-ups; a typed note is
  echoed / acknowledged.
- Exactly one approval dialog per `request_user_approval` call (no duplicate).
- No console errors and no broken layout during the flow.

## Protocol-level check (no browser)

Inside the running container, POST a `RunAgentInput` carrying a
`request_user_approval` tool to `http://127.0.0.1:8000/v1/ag-ui/operator`
(Bearer gateway token, `Accept: text/event-stream`) and confirm the SSE contains
a `TOOL_CALL_START` for `request_user_approval` with a `message` arg. The run
pauses on the pending client tool call — the result comes from the browser
handler, so a headless POST alone cannot complete the loop (that is expected).

## Caveats

- The pause is **frontend-tool-based**, not `interrupt()`-based. There is no
  backend checkpoint; if the page reloads while the dialog is open, the pending
  Promise is lost and the agent will not resume that action.
- The tickets are hard-coded mock data (`tickets-panel.tsx`); approving a refund
  does not mutate any ticket state — the demo showcases the approval gate, not a
  real fulfillment backend.
- Behaviour comes from the frontend + ag-ui client-tools path, not a per-demo
  backend graph — the same mechanism backs the other frontend-tool demos.
