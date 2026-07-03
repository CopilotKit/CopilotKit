# Human in the Loop (In-App)

## What This Demo Shows

A human-in-the-loop approval flow whose UI lives OUTSIDE the chat. When the
agent needs sign-off before a consequential action, it calls a frontend tool
that pops an app-level modal; the run pauses until the operator decides.

- **App-Level Modal**: The approval dialog is portal'd to `<body>`, not rendered
  in the chat bubble tree
- **Async Tool Handler**: The tool returns a Promise that resolves only when the
  operator clicks Approve / Reject
- **Support-Inbox Context**: A tickets panel gives the agent real-looking data
  to act on

## How to Interact

Open the popup chat and ask the agent to take an action on a ticket:

- "Refund the duplicate charge on ticket #12345"
- "Downgrade Priya's plan to Starter"

Approve or reject in the modal that appears; the agent respects your decision.

## Technical Details

**Provider** — `CopilotKit` with `runtimeUrl="/api/copilotkit"` (proxying via an
`HttpAgent` to the clawg-ui AG-UI operator route on the OpenClaw gateway) and
`agent="hitl-in-app"`. The chat is a `CopilotPopup`.

**Async frontend tool** — `useFrontendTool` registers `request_user_approval`.
Its `handler` returns a `new Promise` and stashes the `resolve` fn in state; the
`ApprovalDialog` calls it on click, completing the handler and returning
`{ approved, reason }` to the agent.

**Steering** — `useAgentContext` supplies per-demo operating instructions (call
`request_user_approval` before acting; treat the result as authoritative),
delivered via AG-UI `context[]`.
