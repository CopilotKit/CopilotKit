# Sub-Agents

## What This Demo Shows

A supervisor agent gives work to three specialized sub-agents, and every delegation shows in the UI while it runs.

- **Three sub-agents**: `research_agent` gathers facts, `writing_agent` drafts prose, and `critique_agent` reviews the draft.
- **Sub-agents as tools**: the supervisor calls each sub-agent as a tool. Each call adds an entry to the `delegations` slot of the shared state.
- **Live delegation log**: the left pane renders `state.delegations`. The list grows each time the supervisor calls a sub-agent.
- **Inline cards**: `useRenderTool` renders one card per sub-agent call in the chat, with the task, the status, and the result.

## How to Interact

1. Click a suggestion, for example "Write a blog post".
2. Look at the delegation log and the chat. The supervisor runs research, then writing, then critique.

While the supervisor runs, the suggestions show as loading, and you cannot click them.

## Technical Details

- `useAgent({ agentId: "subagents", updates: [UseAgentUpdate.OnStateChanged, UseAgentUpdate.OnRunStatusChanged] })` reads `state.delegations` and `agent.isRunning` for the log and the banner.
- The banner above the chat names the sub-agent that runs now. `active-subagent.ts` finds the newest sub-agent tool call that has no result yet.
- The backend contract: expose the three sub-agents as tools of the supervisor, and append one entry to `state.delegations` for each call.
