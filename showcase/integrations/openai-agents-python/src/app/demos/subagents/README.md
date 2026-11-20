# Sub-Agents

## What This Demo Shows

A supervisor agent (`subagents_agent()` in `src/demo_agents/subagents.py`)
delegates to three OpenAI Agents SDK sub-agents — `research_agent`,
`writing_agent`, `critique_agent` — through three function tools.

- **Three role tools**: each runs its sub-agent with `Runner.run(...)` (one
  model call with a role-specific prompt, through the same client and
  endpoint as the supervisor) and returns the sub-agent's output.
- **Per-tool cards**: `useRenderTool` renders a `SubAgentActivityCard` for
  each of the three tool names as the supervisor calls them.
- **Live delegation log**: each tool appends an entry to the `delegations`
  slot of shared state with `shared_state().update(...)`, which streams a
  `STATE_SNAPSHOT` as each delegation finishes, so the left-pane
  `DelegationLog` fills in while the supervisor is still running.

## How to Interact

Click a suggestion chip, or type your own prompt. For example:

- "Produce a short blog post about the benefits of cold exposure training. Research first, then write, then critique."
- "Explain how large language models handle tool calling. Research, write a paragraph, then critique."
- "Summarize the current state of reusable rockets in 1 polished paragraph, with research and critique."

Watch the delegation log and the per-tool activity cards fill in as the
supervisor calls `research_agent`, then `writing_agent`, then
`critique_agent`.

## Technical Details

- `Agent.as_tool()` would run the sub-agents too, but it cannot record the
  delegation, so the three tools are spelled out (`_delegate` in
  `src/demo_agents/subagents.py`).
- The supervisor runs with `parallel_tool_calls=False`: research, then
  write, then critique, one delegation per model call.
- `CopilotKit` provider uses `agent="subagents"`, mounted by
  `agent_server.py` from `subagents_agent()`.
- The frontend's `useAgent({ agentId: "subagents", ... })` +
  `agent.state.delegations` wiring is unchanged from the reference. The
  entries have the reference's shape (`id`, `sub_agent`, `task`, `status`,
  `result`).
