# Headless Chat (Simple)

## What This Demo Shows

A chat UI that you build yourself, with no `<CopilotChat />` component. You own the message list, the input and the send button. CopilotKit owns the connection to the agent.

- **Two hooks**: `useAgent` gives the messages and the run state. `useCopilotKit` starts a run.
- **Your design system**: the bubbles, the composer and the empty state are plain shadcn/ui components.
- **Text only**: the page shows user and assistant text. It skips tool calls and the other message types.

## How to Interact

Click a sample prompt in the empty state, or type your own message. For example:

- "Say hello in one short sentence."
- "Tell me a one-line joke."
- "Give me a fun fact."

## Technical Details

- `<CopilotKit runtimeUrl={useDemoRuntimeUrl("headless-simple")} agent="headless-simple">` connects the page to the runtime at `/api/<integration>/headless-simple`.
- `useAgent({ agentId: "headless-simple" })` gives `agent.messages`, `agent.isRunning` and `agent.addMessage`.
- To send a message, the page calls `agent.addMessage`, then `copilotkit.runAgent({ agent })`.
- The message id comes from `randomUUID` in `@copilotkit/shared`. It also works on a plain-HTTP page, where `crypto.randomUUID` does not exist.

For tool cards, attachments and suggestions on the same hand-built UI, see the `headless-complete` demo.
