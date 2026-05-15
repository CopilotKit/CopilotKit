# Agentic Chat (Reasoning)

## What This Demo Shows

A visible chain-of-thought rendered alongside the agent's final answer. Before every response, the Microsoft Agent Framework agent records its reasoning in a `think` tool call, which the frontend renders as a tagged amber block.

## How to Interact

Try asking:

- "What's the capital of Australia, and what's special about it?"
- "If a train leaves at 8am traveling 60mph, when does it arrive 180 miles away?"
- "Recommend a good programming language for someone new to coding."

For each question you'll see two things in the chat:

1. A **Reasoning** block showing the agent's step-by-step thinking.
2. A concise final answer.

## Technical Details

### Why a `think` tool (not `REASONING_MESSAGE_*` events)

The LangGraph reference agent relies on AG-UI `REASONING_MESSAGE_*` events, which CopilotKit surfaces via the first-class `reasoningMessage` slot on `CopilotChat`.

The Microsoft Agent Framework AG-UI bridge doesn't currently emit those events. To provide the equivalent UX, the backend agent is instructed to call `think(thought=...)` before every answer, and the frontend renders that tool call with `useRenderTool` as the reasoning block.

### Backend — `src/agents/reasoning_agent.py`

- Defines a `think` tool whose `thought` argument is the reasoning chain.
- Agent instructions require calling `think` exactly once per user turn, before the final assistant message.
- Mounted at `/reasoning` on the FastAPI server.

### Frontend — `src/app/demos/agentic-chat-reasoning/page.tsx`

- Points the `CopilotKit` provider at `/api/copilotkit-reasoning` with `agent="agentic-chat-reasoning"`.
- Uses `useRenderTool({ name: "think", render })` to render each tool call as a `<ReasoningBlock />` — an amber-tagged "Thinking…" / "Agent reasoning" banner that matches the LangGraph reference visual.

## Building With This

If MS Agent Framework's AG-UI bridge later emits native `REASONING_MESSAGE_*` events, this demo can be simplified by:

- Dropping the `think` tool from the backend.
- Replacing `useRenderTool("think", ...)` with a `messageView.reasoningMessage` slot override on `CopilotChat`.
