# Headless Chat (Complete)

## What This Demo Shows

A full chat UI built from scratch on `useAgent` — no `<CopilotChat />`, no `<CopilotChatMessageView>`, no `<CopilotChatAssistantMessage>`. Every piece of the generative-UI weave is re-composed by hand from the low-level hooks, so you can see exactly where each layer lives and swap any layer for your own chrome.

## How to Interact

Try asking your Copilot to:

- "What's the weather in Tokyo?"
- "Search for flights from SFO to JFK"
- "Highlight 'meeting at 3pm' in yellow"
- "Show a card titled 'Reminder' with body 'Call the client.'"

## Technical Details

### Files

- **`page.tsx`** — provider, agent wiring, send/stop handlers, tool-call renderer registration, and the composer (input bar).
- **`message-list.tsx`** — scrollable messages area + user / assistant bubbles + typing indicator. All pure chrome.
- **`use-rendered-messages.tsx`** — the per-message role dispatch. Mirrors `renderMessageBlock` from `CopilotChatMessageView.tsx` but in user code, so every branch (assistant text, tool-call renders, reasoning, activity, custom before/after) is visible and hackable.

### Key hooks

- **`useAgent({ agentId, threadId })`** — the raw agent handle. Gives you `messages`, `isRunning`, `addMessage`, etc.
- **`useCopilotKit()`** — exposes `connectAgent`, `runAgent`, `stopAgent`. Used directly to drive the lifecycle without a chat component.
- **`CopilotChatConfigurationProvider`** — scopes the activity / custom-message / tool-call registries to a specific `(agentId, threadId)` pair. Required for the headless surface to pick up the right renderers.
- **`useRenderToolCall`** / **`useRenderActivityMessage`** / **`useRenderCustomMessages`** — the three low-level rendering registries, consumed manually by `useRenderedMessages`.
- **`useRenderTool`** / **`useComponent`** / **`useDefaultRenderTool`** — the three ways to register tool-call renderers. All three surface through the same `useRenderToolCall` path.
- **`useConfigureSuggestions`** — the same suggestion system the chat primitive uses; available here because we wrap in `CopilotChatConfigurationProvider`.

### Tools exercised

- **`get_weather`** — backend .NET tool. Rendered as a branded weather card via `useRenderTool`.
- **`highlight_note`** — frontend-only tool, registered via `useComponent`. Proves that tools registered from the frontend flow through the same render path.
- **`show_card`** — frontend-only tool, mirrors the `headless-simple` demo.
- **`search_flights`**, **`generate_a2ui`**, **`get_sales_todos`**, etc. — backend tools on the .NET SalesAgent that do not have a bespoke renderer; caught by `useDefaultRenderTool` so they still get a visible card.

## Backend

Reuses the .NET `SalesAgent` exposed by `agent/Program.cs`. No backend changes are required — the frontend-registered tools (`highlight_note`, `show_card`) are forwarded to the agent on each run via `copilotkit.runAgent`.
