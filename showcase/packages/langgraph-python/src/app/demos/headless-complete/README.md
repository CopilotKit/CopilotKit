# Headless Chat (Complete)

## What This Demo Shows

A chat UI built from scratch on `useAgent` with no `<CopilotChat>`, `<CopilotChatMessageView>`, or `<CopilotChatAssistantMessage>` — yet it still composes the full CopilotKit generative-UI stack.

- **Hand-rolled chrome**: custom user/assistant bubbles, typing indicator, input bar, stop button, and auto-scrolling message list
- **Full rendering stack preserved**: text, tool-call renders, reasoning cards, activity messages, and custom messages all composed manually from low-level hooks
- **MCP Apps wired in**: routed through `/api/copilotkit-mcp-apps` so the agent can invoke Excalidraw MCP tools whose activity events surface inline

## How to Interact

Click a suggestion chip, or type your own prompt. For example:

- "What's the weather in Tokyo?"
- "What's AAPL trading at right now?"
- "Highlight 'meeting at 3pm' in yellow."
- "Use Excalidraw to sketch a simple system diagram."

The agent routes each question to the matching surface — backend tool, frontend `highlight_note` component, or MCP activity.

## Technical Details

- **Orchestration** — `useAgent({ agentId, threadId })` plus `useCopilotKit()` drive the lifecycle: `copilotkit.connectAgent`, `agent.addMessage`, `copilotkit.runAgent`, and `copilotkit.stopAgent` replace everything `<CopilotChat>` would do internally
- **Message composition** — `use-rendered-messages.tsx` calls `useRenderToolCall`, `useRenderActivityMessage`, and `useRenderCustomMessages` directly, mirroring the role-dispatch inside `CopilotChatMessageView` and folding tool-role results into the preceding assistant message
- **Config provider** — `CopilotChatConfigurationProvider` scopes the `(agentId, threadId)` pair so the manual renderers resolve correctly and `useConfigureSuggestions` registers against this agent
- **Reasoning leaf** — only `CopilotChatReasoningMessage` is imported, as a pure presentational primitive for reasoning-role messages
