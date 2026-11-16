# In-App Human in the Loop

## What This Demo Shows

A support copilot asks the operator to approve each action that affects a customer. The approval is a modal dialog in the app, outside the chat.

- **Approval before action**: the agent stops and waits for your decision.
- **Dialog outside the chat**: the dialog opens over the support inbox, not in a chat message.
- **Your decision goes back to the agent**: the agent gets your decision and your note as the tool result.

## How to Interact

Click a suggestion in the chat:

- **Approve refund for #12345**
- **Downgrade plan for #12346**
- **Escalate ticket #12347**

The agent asks for approval, and a dialog opens. You can add a note. Then click **Approve** or **Reject**. The next message of the agent uses your decision.

## Technical Details

- `useFrontendTool` registers the `request_user_approval` tool. Its handler returns a Promise and keeps the `resolve` function of that Promise in state.
- `ApprovalDialog` renders into `document.body` with `createPortal`, outside the chat.
- **Approve** and **Reject** call the stored `resolve` with `{ approved, reason }`. The agent gets this object as the tool result.
- The dialog shows one request at a time. If a second request arrives while the dialog is open, the handler rejects it with a reason. The first request keeps its dialog.

`CopilotKit` connects the page to the runtime:

- `runtimeUrl` is `/api/<integration>/hitl-in-app`. `useDemoRuntimeUrl("hitl-in-app")` makes it from the `[integration]` segment of the page URL.
- `agent="hitl-in-app"` selects the agent that `src/integrations/<integration>/agents.ts` registers for this demo.
