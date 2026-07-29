# Sub-Agents

## What This Demo Shows

Multi-agent delegation with a live log. A supervisor LLM orchestrates three specialized sub-agents exposed as tools, and every delegation streams into the UI in real time via shared agent state.

- **Three specialized sub-agents**: `research_agent` (gathers facts), `writing_agent` (drafts prose), `critique_agent` (reviews drafts) — each is its own single-shot Anthropic call with a dedicated system prompt
- **Sub-agents-as-tools**: the supervisor calls them through tool schemas; the run loop runs the matching sub-agent and appends an entry to the shared `delegations` state slot
- **Live delegation log**: the left pane renders `delegations` from agent state, growing as the supervisor fans work out

## How to Interact

Click a suggestion chip, or type your own prompt. For example:

- "Produce a short blog post about the benefits of cold exposure training. Research first, then write, then critique."
- "Explain how large language models handle tool calling. Research, write a paragraph, then critique."
- "Summarize the current state of reusable rockets in 1 polished paragraph, with research and critique."

Watch the delegation log fill in as the supervisor runs research → write → critique.

## Technical Details

- Each delegation runs its sub-agent synchronously, appends an entry to `state["delegations"]`, and emits a `STATE_SNAPSHOT` event — updating shared state AND feeding the sub-agent's output back to the supervisor as a `tool_result` in one step
- Shared state carries `delegations: list[Delegation]`; the dedicated `/subagents` endpoint (`src/agents/subagents_agent.py`) streams it to the frontend
- Frontend uses `useAgent({ agentId: "subagents", updates: [UseAgentUpdate.OnStateChanged, UseAgentUpdate.OnRunStatusChanged] })` and reads `agent.state.delegations` + `agent.isRunning` to drive the log
- `CopilotKit` provider uses `agent="subagents"`, backed by `src/agents/subagents_agent.py`
