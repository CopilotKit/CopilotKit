# Sub-Agents

## What This Demo Shows

Multi-agent delegation with a live log. A supervisor LLM orchestrates three specialized sub-agents exposed as tools, and every delegation streams into the UI in real time via shared agent state.

- **Three specialized sub-agents**: `research_agent` (gathers facts), `writing_agent` (drafts prose), `critique_agent` (reviews drafts) — each is a nested `chat()` call with its own system prompt
- **Sub-agents-as-tools**: the supervisor calls them through server tool definitions; each tool runs the nested sub-agent and returns a delegation result
- **Live delegation log**: the left pane renders `delegations` from agent state, growing as the supervisor fans work out

## How to Interact

Click a suggestion chip, or type your own prompt. For example:

- "Produce a short blog post about the benefits of cold exposure training. Research first, then write, then critique."
- "Explain how large language models handle tool calling. Research, write a paragraph, then critique."
- "Summarize the current state of reusable rockets in 1 polished paragraph, with research and critique."

Watch the delegation log fill in as the supervisor runs research → write → critique.

## Technical Details

- Each delegation tool wraps a nested TanStack `chat()` call and returns `{ role, text }` to the supervisor
- The Built-in Agent bridge converts delegation tool results into `STATE_SNAPSHOT` events so the frontend can render the live log
- Frontend uses `useAgent({ agentId: "subagents", updates: [UseAgentUpdate.OnStateChanged, UseAgentUpdate.OnRunStatusChanged] })` and reads `agent.state.delegations` + `agent.isRunning` to drive the log
- `CopilotKit` provider uses `agent="subagents"`, backed by the in-process Built-in Agent runtime
