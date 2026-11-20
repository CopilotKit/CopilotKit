# Sub-Agents

## What This Demo Shows

Multi-agent delegation with a shared-state log. A supervisor LLM calls three sub-agents as tools. The log adds each delegation when its tool returns.

- **Three specialized sub-agents**: `research_agent` gathers facts, `writing_agent` drafts prose, and `critique_agent` reviews drafts. Each is a PydanticAI `Agent`.
- **Sub-agents as tools**: The supervisor calls each agent through an `@agent.tool` function. Each tool returns the agent's text to the supervisor.
- **Delegation log**: Each tool returns a `StateSnapshotEvent` in `ToolReturn.metadata`. The left pane adds that delegation when the tool returns.

## How to Interact

Click a suggestion chip, or type your own prompt. For example:

- "Produce a short blog post about the benefits of cold exposure training. Research first, then write, then critique."
- "Explain how large language models handle tool calling. Research, write a paragraph, then critique."
- "Summarize the current state of reusable rockets in 1 polished paragraph, with research and critique."

Watch the delegation log fill in as the supervisor runs research → write → critique.

## Technical Details

- Each delegation tool returns `ToolReturn` with the sub-agent text and a snapshot of `SubagentsState.delegations`.
- `StateDeps[SubagentsState]` passes the state to each PydanticAI tool. The AG-UI adapter forwards the snapshot to the browser.
- Frontend uses `useAgent({ agentId: "subagents", updates: [UseAgentUpdate.OnStateChanged, UseAgentUpdate.OnRunStatusChanged] })` and reads `agent.state.delegations` + `agent.isRunning` to drive the log
- `CopilotKit` provider uses `agent="subagents"`, backed by `src/agents/subagents.py`
