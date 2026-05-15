# In-App Human in the Loop (Frontend Tools + async HITL)

## What This Demo Shows

A support-operations console where the agent must get explicit human approval — via a modal dialog rendered OUTSIDE the chat — before taking any customer-affecting action.

- **Approval lives in the app, not the chat**: a portal'd `ApprovalDialog` appears over the whole page when the agent requests consent
- **Async frontend tool**: `request_user_approval` returns a Promise that only resolves when the operator clicks Approve or Reject
- **Agent obeys the decision**: on approve it confirms; on reject it stops and reflects the operator's reason

## How to Interact

Try asking:

- "Please approve a $50 refund to Jordan Rivera on ticket #12345 for the duplicate charge"
- "Downgrade Priya Shah (#12346) to the Starter plan effective next billing cycle"
- "Escalate ticket #12347 to the payments team"

The agent will open the approval dialog with the exact action; approve or reject (optionally with a note) and the agent acknowledges.

## Technical Details

- `useFrontendTool({ name: "request_user_approval", handler })` registers the tool — the `handler` returns `new Promise(resolve => setDialog({ open: true, resolve }))`, stashing `resolve` in React state
- The `ApprovalDialog` (rendered via `createPortal` to `document.body`) calls that stashed `resolve({ approved, reason })` on button click, completing the handler and handing the result back to the agent
- The backend agent (`src/agents/hitl_in_app.py`) has `tools=[]` — the system prompt instructs it to call `request_user_approval` before any customer-affecting action
- Layout is a split pane: tickets list + `CopilotChat` with `agent="hitl-in-app"`
