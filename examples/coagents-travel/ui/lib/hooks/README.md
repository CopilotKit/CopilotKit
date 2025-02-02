# use-trips.tsx

This hook is where most of the magic happens for Copilotkit (if you're looking for the rest, check out [app/page.tsx](../../app/page.tsx) and [api/copilotkit/route.ts](../../app/api/copilotkit/route.ts)). It handles interacting with the CoAgent's state and provides helper functions for the UI to interact with and update the CoAgent's state. It also provides intermediate streaming for human-in-the-loop components as well as progress tracking.

## Key Concepts

### useCoAgent

This allows us to read and interact with the CoAgent's state. Since this is a two-way interaction, we have a `state` and `setState` function. When the CoAgent's state changes, the `state` will automatically trigger re-renders to create reactive experiences.

For more information on how to use `useCoAgent`, check out the [reading](https://docs.copilotkit.ai/coagents/react-ui/in-app-agent-read) and [writing](https://docs.copilotkit.ai/coagents/react-ui/in-app-agent-write) state docs.

### useCoAgentStateRender

This hook allows us to render state from the CoAgent in a custom way. In this example, we're rendering `search_progress` which is emitted to us from the CoAgent as it conducts a search for places.

In order for this to work, we need to have the CoAgent emit the `search_progress` state, which you can see being done in [agent/travel/search.py](../../../agent/travel/search.py).

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

With those lines of code, the `useCoAgentStateRender` hook will be able to detect the `copilotkit_emit_state` calls and trigger our rendering logic in the chat `search_progress` state.

For more information on agentic generative UI, checkout the [docs](https://docs.copilotkit.ai/coagents/chat-ui/render-agent-state).


### useCopilotAction

This hook is used to add front-end functions as tool calls to an agent or LLM. This is particularly useful for human in the loop components. If you're completely new to the concept of human in the loop, checkout LangGraph's [docs](https://langchain-ai.github.io/langgraph/concepts/human_in_the_loop/?h=human) where they talk about the concept in more detail with some examples.

For our needs, we can keep it simple and think of it as a way to force the LLM for user approval before performing some action. This is accomplished two ways.

1. Setting a "breakpoint" in the agent code via the `interrupt_after` option when compiling an agent.
2. Emitting tool calls via the Copilotkit SDK.
3. Sending approval/rejection response back to the agent via our `useCopilotAction` hook.

This is gone into in more detail in our documentation on implementing [human in the loop](https://docs.copilotkit.ai/coagents/chat-ui/hitl/json-hitl).
