# Reasoning (Default Render)

## What This Demo Shows

Zero-custom-styling display of the agent's reasoning chain, approximating the built-in `CopilotChatReasoningMessage` render used in the LangGraph reference.

## How to Interact

Try asking:

- "Why is the sky blue?"
- "What's the best way to learn TypeScript?"
- "How long does it take to walk 5 miles at 3 mph?"

Each answer is preceded by a collapsible **Thinking…** / **Thought for a moment** card.

## Technical Details

### Why this isn't strictly zero-config

The LangGraph reference uses `CopilotChat` with no custom slots. CopilotKit's native `CopilotChatReasoningMessage` slot renders automatically because the LangGraph backend emits AG-UI `REASONING_MESSAGE_*` events.

The Microsoft Agent Framework AG-UI bridge does not currently emit those events. To provide the closest equivalent, the same `reasoning_agent.py` backend that powers `agentic-chat-reasoning` is reused: it calls a `think(thought=...)` tool before every answer, and this demo renders the tool call with a `DefaultReasoningMessage` component that mimics the stock collapsible "Thinking…" card.

When the MS Agent Framework AG-UI bridge adds native reasoning events, this demo can collapse to the truly zero-config form (no `useRenderTool`, no custom component).

### Backend

- Shares `src/agents/reasoning_agent.py` with `agentic-chat-reasoning` — one agent mounted at `/reasoning`, registered under the `reasoning-default-render` name in `src/app/api/copilotkit-reasoning/route.ts`.

### Frontend

- `src/app/demos/reasoning-default-render/page.tsx` — points at `/api/copilotkit-reasoning` with `agent="reasoning-default-render"`.
- Uses `useRenderTool("think", ...)` with an internal `DefaultReasoningMessage` component styled to look like the built-in slot.
