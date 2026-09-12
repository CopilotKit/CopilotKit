# Sub-Agents

## What This Demo Shows

A supervisor `AntigravityAgent` (`subagents_agent()` in
`src/agents/subagents.py`) delegates to three roles — `research_agent`,
`writing_agent`, `critique_agent` — implemented as ordinary **server-side
tools**, not Antigravity's native sub-agent capability. That native
capability is disabled on this integration (`enable_subagents=False`), the
same way the SDK's built-in `ask_question` tool is disabled: both would open
an interrupt this showcase doesn't know how to drive.

- **Three role tools**: each is an `async def` that makes one additional
  chat-completion call through the OpenAI-compatible shim
  (`src/openai_proxy.py`) using its own role-specific prompt, and returns the
  resulting prose.
- **Per-tool cards carry the delegation, not a shared log**: `useRenderTool`
  renders a `SubAgentActivityCard` for each of the three tool names as the
  supervisor calls them, so research → write → critique is still visible
  unfolding live in the transcript.
- **The delegation log stays empty on this integration**: the left-pane
  `DelegationLog` component reads the `delegations` slot of agent state, but
  this adapter has no state-writer path yet — `STATE_SNAPSHOT` is only
  emitted from `structured_output` at the very end of a turn, so nothing
  populates it mid-run. The three per-tool activity cards are where the
  delegation is actually visible here.

## How to Interact

Click a suggestion chip, or type your own prompt. For example:

- "Produce a short blog post about the benefits of cold exposure training. Research first, then write, then critique."
- "Explain how large language models handle tool calling. Research, write a paragraph, then critique."
- "Summarize the current state of reusable rockets in 1 polished paragraph, with research and critique."

Watch the three per-tool activity cards fill in as the supervisor calls
`research_agent`, then `writing_agent`, then `critique_agent`.

## Technical Details

- Each role tool posts to the shim's `/v1/chat/completions` endpoint over a
  shared `httpx.AsyncClient`, stamping `X-AIMock-Context` itself (see
  `src/agents/subagents.py`). The tools are deliberately `async def`: a
  synchronous call here would block the whole agent process's event loop for
  the duration of the model call, stalling every other in-flight run.
- The supervisor's tools are declared directly on
  `AntigravityAgent(tools=[research_agent, writing_agent, critique_agent])`;
  the adapter dispatches each call itself and emits its `TOOL_CALL_RESULT`
  from the real return value.
- `CopilotKit` provider uses `agent="subagents"`, mounted by
  `agent_server.py` from `subagents_agent()` in `src/agents/subagents.py`.
- The frontend's `useAgent({ agentId: "subagents", ... })` +
  `agent.state.delegations` wiring is unchanged from the reference — it will
  render correctly once this adapter gains a shared-state write path. Until
  then, expect the log's empty state ("Ask the supervisor to complete a
  task...") even while the per-tool cards above it are filling in.
