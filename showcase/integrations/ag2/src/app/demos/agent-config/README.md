# Agent Config Object (AG2)

Forward a typed configuration object (`tone`, `expertise`, `responseLength`)
from the provider to the agent. The agent reads the values from AG2's
ContextVariables on every run and rebuilds its system prompt per turn.

## Files

- `page.tsx` — `<CopilotKit>` provider plus a `ConfigStateSync` bridge that
  pushes the latest config into `agent.setState({...})`.
- `config-card.tsx` — three select inputs.
- `config-types.ts` / `use-agent-config.ts` — typed state + reducer.
- `../../../agents/agent_config_agent.py` — AG2 ConversableAgent that reads
  ContextVariables and updates its system message before each reply.

## Notes

AG2's `AGUIStream` maps `agent.setState()` into ContextVariables. The agent
rebuilds its system prompt from three rulebooks (tone / expertise / length)
keyed by the latest config snapshot.
