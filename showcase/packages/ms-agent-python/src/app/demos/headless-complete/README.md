# Headless Chat (Complete)

## What This Demo Shows

A full chat implementation built entirely from scratch on `useAgent` — no `<CopilotChat />`, no `<CopilotChatMessageView>`, no `<CopilotChatAssistantMessage>`. Demonstrates that every piece of the generative-UI composition (text, reasoning, tool-call renders, activity messages, custom-message renderers) can be re-composed by hand from the low-level hooks, while still driving the shared MS Agent Framework backend.

## How to Interact

Try asking your Copilot to:

- "What's the weather in Tokyo?" — renders the inline `WeatherCard`
- "Add a sales todo called 'Follow up with Acme'"
- "Schedule a 30-minute meeting to review Q4 pipeline"
- "Search for flights from SFO to NYC next Friday"
- "Highlight 'meeting at 3pm' in yellow" — exercises the frontend-only `highlight_note` component

The agent id `headless-complete` is wired to the shared MS Agent backend, so every existing backend tool (weather, sales todos, schedule meeting, search flights, generate_a2ui) is reachable. Tools without a bespoke renderer fall through to `useDefaultRenderTool` and still render visibly.

## Technical Details

**Three-file layout:**

- `page.tsx` — the provider, the agent lifecycle (connect on mount, runAgent on send, stopAgent on cancel), the input bar, and the frontend tool registrations (`useRenderTool`, `useComponent`, `useDefaultRenderTool`).
- `message-list.tsx` — scrollable message container with auto-scroll fingerprinting, user / assistant bubble chrome, and a typing indicator. Reads the rendered message list from the hook and dispatches on role.
- `use-rendered-messages.tsx` — the heart of the demo. Mirrors the role-dispatch logic from `CopilotChatMessageView`, using `useRenderToolCall`, `useRenderActivityMessage`, and `useRenderCustomMessages` to produce a `renderedContent` node for every message.

**`useAgent`** returns the live agent instance whose `.messages` array and `.isRunning` flag drive the view. The hook creates a new `threadId` per mount so each page load gets a clean thread.

**`copilotkit.connectAgent({ agent })`** is called in a `useEffect` so the backend session is live before the first send. An `AbortController` is assigned to the agent's `abortController` field and aborted on unmount, matching the internal behavior of `<CopilotChat />` under React StrictMode.

**`copilotkit.runAgent({ agent })`** is the correct entry point from custom UI; calling `agent.runAgent()` directly bypasses frontend-tool forwarding.

**`CopilotChatConfigurationProvider`** is wrapped around the chat body so the `(agentId, threadId)` scope is visible to `useRenderToolCall`, `useRenderActivityMessage`, `useRenderCustomMessages`, and `useConfigureSuggestions`. Without it, activity renderers wouldn't scope correctly and custom message renderers would early-return null.

**Manual message composition** in `use-rendered-messages.tsx`:

- `role === "assistant"` — text content + `toolCalls.map(renderToolCall)`. Tool results (`role === "tool"`) are matched by `toolCallId` and passed alongside.
- `role === "user"` — plain text extraction (string or AG-UI content parts).
- `role === "reasoning"` — the one CopilotKit leaf primitive we keep (`CopilotChatReasoningMessage`), since it's presentational only.
- `role === "activity"` — `renderActivityMessage(message)`.
- `role === "tool"` — null (folded into the preceding assistant's tool-call render).
- Custom-before / custom-after slots from `useRenderCustomMessages` wrap every non-tool body.

**Plain-text rendering** — intentionally no markdown pipeline. The cell's goal is to show what fully user-owned composition looks like; apps that want markdown can drop Streamdown or react-markdown into exactly one place (`renderAssistantBody`).

## Building With This

Use this demo as a starting point when you need a chat surface that:

- Ships your own bubble chrome / spacing / colors instead of the CopilotKit default
- Composes custom-message renderers above or below each turn
- Embeds a chat inside a larger UI (sidebar, modal, split pane) where `<CopilotChat />`'s full-height layout gets in the way
- Needs a stop button or custom send button placement

For a minimal starting point without the full role-dispatch weave, see the sibling [Headless Chat (Simple)](../headless-simple/README.md) demo.
