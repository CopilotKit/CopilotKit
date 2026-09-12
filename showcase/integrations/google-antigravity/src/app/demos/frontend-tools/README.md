# Frontend Tools (In-App Actions)

## What This Demo Shows

Frontend tools (a.k.a. "in-app actions") let the agent call functions that live in your React app. The agent reasons about when to invoke them based on natural conversation.

## How to Interact

Try asking:

- "Change the background to a blue-to-purple gradient"
- "Make the background a sunset theme"
- "Set the background to black"

## Technical Details

A frontend tool is registered with `useFrontendTool`:

```tsx
useFrontendTool({
  name: "change_background",
  description: "...",
  parameters: z.object({ background: z.string() }),
  handler: async ({ background }) => {
    setBackground(background);
    return { status: "success" };
  },
});
```

CopilotKit automatically advertises the tool to the agent. The agent decides when to call it based on the conversation, and the handler runs client-side.

### How this reaches Google Antigravity

On this integration, every `RunAgentInput.tools` entry — including
`change_background` — becomes a real Antigravity tool, built from its JSON
Schema and validated by the harness like any tool it knows about natively.
When the model calls it, the call **parks as an awaited coroutine**: the
agent's AG-UI run ends, and the call resumes on the next run once your
browser answers with a `ToolMessage` carrying the `tool_call_id`. There's no
proxy tool or fire-and-forget workaround — the model's tool result really is
whatever your `handler` returned. `deduplicate_tool_calls` also keeps a
frontend tool from being dispatched to the client more than once per turn,
even if the harness re-issues the call.

Backed by the shared `neutral_agent()` in `src/agents/chat.py`, mounted at
`/frontend_tools` by `agent_server.py` (see `src/agents/registry.py`).
