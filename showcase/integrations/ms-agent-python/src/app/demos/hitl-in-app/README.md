# In-App HITL (Async Frontend Tool + App-Level Modal)

## What This Demo Shows

Human-in-the-loop approval where the confirmation UI pops up as a **modal dialog outside the chat**, not inline inside a chat bubble. The agent calls a frontend-registered tool; the tool's async handler opens a portal'd dialog and awaits the user's decision before returning control to the agent.

## How to Interact

The left pane lists a handful of mock support tickets. Ask the Copilot on the right to take an action on one of them:

- "Please approve a $50 refund to Jordan Rivera on ticket #12345 for the duplicate charge."
- "Please downgrade Priya Shah (#12346) to the Starter plan effective next billing cycle."
- "Please escalate ticket #12347 to the payments team — Morgan Lee's payment is stuck."

A modal dialog pops up in the center of the screen (outside the chat bubble tree) summarizing the proposed action. Optionally add a note, then click **Approve** or **Reject**. The agent acknowledges the decision in the chat.

## Technical Details

What's happening technically:

- The frontend registers a tool named `request_user_approval` via `useFrontendTool`. The tool's `handler` is `async` and returns a Promise.
- When the agent calls `request_user_approval`, the handler stashes the Promise's `resolve` into component state and flips a `DialogState` to `{ open: true }`. React renders the `<ApprovalDialog />` portal'd to `<body>`.
- The user clicks Approve / Reject. The dialog calls the `resolve` fn with `{ approved, reason? }`, completing the frontend-tool handler. The value flows back to the agent as the tool result.
- The agent's system prompt treats that result as authoritative and responds with a short confirmation or rejection message.

Key files:

- `src/agents/hitl_in_app_agent.py` -- MS Agent Framework agent with `tools=[]` and a system prompt describing the `request_user_approval` frontend tool.
- `src/app/demos/hitl-in-app/page.tsx` -- `useFrontendTool` registration + dialog state management.
- `src/app/demos/hitl-in-app/approval-dialog.tsx` -- portal'd modal dialog rendered at the app level.

## Why Put the Dialog Outside the Chat?

The in-chat HITL pattern (see the `hitl` demo) keeps everything in the chat transcript and is great for **plan-style** flows where the user curates a list. The app-level modal pattern is the right fit when:

- The action is high-stakes and deserves a **focused, blocking** UI that grabs the user's attention.
- The action is conceptually part of the app, not part of the chat transcript (refunds, deletes, payments).
- You want to consume additional context from the surrounding app (e.g. the ticket list) while approving.

## Building With This

The frontend-tool handler returns `await new Promise(resolve => setDialog({ open: true, pending, resolve }))`. The dialog's Approve / Reject buttons call `resolve(...)` -- which completes the frontend-tool Promise and hands the value back to the agent.

This pattern composes with any React modal library. The showcase uses a hand-rolled portal for zero dependencies.
