# Frontend Tool Thread Round Trip

## What This Demo Shows

A frontend tool must work in a thread that the SDK makes, and in a thread that you choose. This page is a regression check for both cases. It is not in the demo list of any integration.

- **Frontend tool**: `testFrontendToolCalling` returns `handled <label>`, and its card shows the label and the result.
- **Thread toggle**: a checkbox switches between an SDK-generated thread and one fixed thread ID.

## How to Interact

1. Send a message that asks the agent to call `testFrontendToolCalling` with a label.
2. Make sure that the tool card shows the label and the result.
3. Select **Explicit threadId**, then send the message again.

## Technical Details

- `CopilotChatConfigurationProvider` sets the thread. In explicit mode it gets a fixed `threadId` and `hasExplicitThreadId`.
- The provider has a `key` for each mode, so the chat starts again in a new thread when you change the mode.
- The tool sets `followUp: true`, so the agent continues after the tool result.
