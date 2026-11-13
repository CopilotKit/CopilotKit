# use-trips.tsx

This hook is where most of the CopilotKit integration happens. For the rest, see [app/page.tsx](../../app/page.tsx) and the [v2 runtime route](../../app/api/copilotkit/[[...slug]]/route.ts). It reads and updates agent state, registers the human-in-the-loop tools, configures chat suggestions, and renders place-search progress.

This example uses CopilotKit v2. See the [v2 migration guide](https://docs.copilotkit.ai/migrate/v2) for the API changes from v1.

## Key Concepts

### useAgent

`useAgent` returns the v2 agent instance. The UI reads `agent.state` and writes changes with `agent.setState`. Agent state updates trigger the hook to render again.

The provider waits for `isReady` before it seeds the default trips, so it does not write to the temporary agent used while the runtime connects.

### useRenderTool

`useRenderTool` renders the existing `search_for_places` backend tool. Its card reads `search_progress` from agent state while the agent searches for places.

The agent emits that progress in [agent/src/search.py](../../agent/src/search.py):

```python
# ...
config = copilotkit_customize_config(
    config,
    emit_intermediate_state=[{
        "state_key": "search_progress",
        "tool": "search_for_places",
        "tool_argument": "search_progress",
    }],
)
# ...
await copilotkit_emit_state(config, state)
# ...
```

Those calls update `agent.state`, which refreshes the progress card in the chat.

### useHumanInTheLoop

`useHumanInTheLoop` registers the add, edit, and delete trip tools with Zod schemas. Each tool pauses for approval and sends the user's response back to the LangGraph agent.

This uses two parts:

1. The agent sets a breakpoint with `interrupt_after` when it compiles the graph.
2. The UI sends the approval or rejection through the `respond` callback from `useHumanInTheLoop`.

See the [v2 human-in-the-loop reference](https://docs.copilotkit.ai/reference/v2/hooks/useHumanInTheLoop) for the hook contract.
