# Agent Config Object

## What This Demo Shows

Forwarded props flowing from the React provider into the Microsoft Agent
Framework agent's system prompt on every turn. The agent adapts tone,
assumed expertise, and response length based on selector state — no code
change, no conversation restart.

## How to Interact

1. Pick a tone, expertise level, and response length from the config card.
2. Send any message (e.g. "Explain how a database index works").
3. Change one of the selects and send a follow-up ("Explain it again").
4. Compare the two responses — the second reflects the new settings.

## Technical Details

**Provider properties** are passed via `<CopilotKit properties={{...}}>`.
CopilotKit serializes them into the AG-UI `forwardedProps` field on every
agent run.

**Backend** — `src/agents/agent_config_agent.py` defines
`AgentConfigFrameworkAgent`, a subclass of `AgentFrameworkAgent` that
overrides `run_agent`:

1. Reads `forwardedProps` from the AG-UI input dict with defensive defaults.
2. Composes a system prompt from three small rulebooks (tone / expertise /
   length).
3. Prepends that prompt as a system message before delegating to the default
   orchestrator chain.

The underlying MS Agent Framework `Agent` is static — per-turn customization
rides in as an injected leading system message rather than by rebuilding the
agent.

**Dedicated route** — this demo has its own runtime at
`/api/copilotkit-agent-config` proxying to the backend's `/agent-config`
FastAPI endpoint. Scoping keeps the dynamic-prompt behaviour out of the
shared agent used by other demos.
