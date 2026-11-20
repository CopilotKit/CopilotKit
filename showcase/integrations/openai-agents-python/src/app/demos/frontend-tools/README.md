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

### How this reaches the OpenAI Agents SDK

The `ag-ui-openai-agents` adapter turns every `RunAgentInput.tools` entry —
including `change_background` — into a `FunctionTool` proxy built from its
JSON Schema. When the model calls it, the proxy ends the agent's AG-UI run
and hands the call to the browser; the next run carries your handler's
result as a `ToolMessage`, and the agent continues from the full history.

Backed by the shared `neutral_agent()` in `src/demo_agents/chat.py`, mounted
at `/frontend_tools` by `agent_server.py` (see `src/demo_agents/registry.py`).
