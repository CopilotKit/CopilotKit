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
  Gemini `generateContent` call with its own role-specific prompt, against the
  same endpoint as the harness (aimock under compose), and returns the
  resulting prose.
- **Per-tool cards**: `useRenderTool` renders a `SubAgentActivityCard` for
  each of the three tool names as the supervisor calls them.
- **Live delegation log**: each tool appends an entry to the `delegations`
  slot of shared state with the adapter's `experimental_get_state()` / `experimental_set_state()`. The
  adapter streams a `STATE_SNAPSHOT` as each tool finishes, so the left-pane
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

- Each role tool posts a Gemini `generateContent` request over a shared
  `httpx.AsyncClient`, stamping `X-AIMock-Context` itself (see
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
  `agent.state.delegations` wiring is unchanged from the reference. The
  entries have the reference's shape (`id`, `sub_agent`, `task`, `status`,
  `result`). `experimental_get_state()` / `experimental_set_state()` only work inside a server tool,
  where the adapter knows which session the call belongs to.
