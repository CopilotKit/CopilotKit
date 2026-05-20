# Agent Config Object

## What This Demo Shows

A typed config object on the frontend (`tone`, `expertise`,
`responseLength`) is forwarded to the Agno agent on every run via the
CopilotKit provider's `properties` prop. The agent reads those values
from `RunAgentInput.forwarded_props` and composes a fresh system prompt
per turn.

## How to Interact

Pick a tone, expertise, and response length, then chat with the agent.
Switch the dropdowns and send another message — the agent's voice
adapts immediately.

## Technical Details

- Frontend: `page.tsx` passes a memoized `properties` object to
  `<CopilotKit>`.
- Runtime: `src/app/api/copilotkit-agent-config/route.ts` —
  `HttpAgent` pointed at `/agent-config/agui`.
- Backend handler: `src/agent_server.py::_run_agent_config` — reads
  `forwarded_props`, calls `build_agent_config_agent(...)` to construct
  a per-request Agno agent, then streams its response through the stock
  AGUI mapper.
- Prompt rules live in `src/agents/agent_config_agent.py`.
