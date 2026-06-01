# Headless Chat (Simple)

## What This Demo Shows

How to build your own chat UI from scratch on top of CopilotKit's primitives — no `CopilotChat` component, no slots. You own the message list, the input, and the send button; CopilotKit owns the agent connection and tool routing.

- **Custom message list**: iterate over `agent.messages` and render your own bubbles for user and assistant roles
- **Custom input**: a plain textarea + button drive `agent.addMessage` and `copilotkit.runAgent`
- **Generative UI still works**: `useComponent` registers a `show_card` component that the agent can render inside your custom layout

## How to Interact

Type any prompt. For example:

- "Show a card about cats"
- "Show me a card titled 'CopilotKit' with a short description"
- "Say hi"

Asking for a card triggers the `show_card` component, which renders as a titled card inside your custom message list.

## Technical Details

- `CopilotKit` wires the page with `runtimeUrl="/api/copilotkit"` and `agent="headless-simple"`, backed by the default `graph` in `src/agents/main.py`
- `useAgent({ agentId: "headless-simple" })` exposes `agent.messages`, `agent.isRunning`, and `agent.addMessage`; `useCopilotKit` exposes `copilotkit.runAgent` for triggering a run
- `useComponent` registers the `show_card` component (title + body, zod-typed) and `useRenderToolCall` returns a renderer that turns tool calls into React
- Calling `copilotkit.runAgent({ agent })` (not `agent.runAgent()` directly) is required so that frontend-registered components are forwarded to the agent
- Reach for headless when you need full control over the chat shell; use `CopilotChat` + slots for anything less drastic
