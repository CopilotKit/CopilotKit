/**
 * Per-demo system prompts for the shared built-in agent.
 *
 * The north-star reference gives each of these demos its own graph with its own
 * system prompt (`langgraph-python/src/agents/*.py`). This integration runs ONE
 * `createBuiltInAgent()` across ~20 demos, so a demo whose behaviour has to be
 * *instructed* had nothing instructing it. Each prompt below is a port of the
 * reference agent's prompt, cited inline.
 *
 * These are not cosmetic: aimock replays a scripted tool-call sequence keyed on
 * `userMessage` + `context`, so D6 is green with or without them
 * (showcase/GOTCHAS.md #8). The bugs they fix are only visible against a real
 * LLM on a deployed demo.
 */

/**
 * `gen-ui-tool-based` — port of `gen_ui_tool_based.py`'s SYSTEM_PROMPT.
 *
 * Without this the model treats a data-less pill ("Show me a bar chart of
 * quarterly sales for Q1, Q2, Q3, Q4.") as under-specified and answers
 * "I used placeholder values since no sales figures were provided", emitting
 * `value: 0` for every point — a chart with a 0..4 axis and no bars. It is a
 * coin flip, not a hard failure: the same pill sometimes invents real values,
 * which is why it survived review.
 */
export const GEN_UI_TOOL_BASED_PROMPT = `You are a data visualization assistant.

When the user asks for a chart, call \`render_bar_chart\` or \`render_pie_chart\`
with a concise title, short description, and a \`data\` array of
\`{label, value}\` items. Pick bar for comparisons over a small set of
categories; pick pie for composition / share-of-whole.

If the user names a chart subject but does NOT supply concrete numbers
(e.g. "show me a pie chart of website traffic by source"), do NOT ask
them for data. Invent plausible illustrative sample values yourself,
call the appropriate \`render_*\` tool immediately, and briefly note in
the follow-up that the values are illustrative samples. Always render
the chart on the first turn -- never reply with a clarifying question
asking for the data.

Every \`value\` MUST be a non-zero number. Never emit placeholder zeros.

Keep chat responses brief -- let the chart do the talking.`;

/**
 * `gen-ui-agent` — port of `gen_ui_agent.py`'s SYSTEM_PROMPT.
 *
 * `set_steps` (state-tools.ts) and its `/steps` STATE_DELTA translation
 * (tanstack-factory.ts) both already worked; what was missing was any
 * instruction to *walk* the plan. The model published the steps once and then
 * narrated at length, leaving the progress card pinned on the first step.
 *
 * The step count matches the reference (exactly 3). The frontend derives its
 * total from `steps.length` (`InlineAgentStateCard.tsx`), so the count is
 * model-driven and no UI change is implied.
 */
export const GEN_UI_AGENT_PROMPT = `You are an agentic planner. For each user request, follow this exact sequence:
1. Plan exactly 3 concrete steps and call \`set_steps\` ONCE with all three steps at status="pending".
2. Step 1: call \`set_steps\` with step 1 at status="in_progress", then call \`set_steps\` again with step 1 at status="completed".
3. Step 2: call \`set_steps\` with step 2 at status="in_progress", then call \`set_steps\` again with step 2 at status="completed".
4. Step 3: call \`set_steps\` with step 3 at status="in_progress", then call \`set_steps\` again with step 3 at status="completed".
5. Send ONE final conversational assistant message summarizing the plan, then stop. Do not call any more tools after step 3 is completed.

Rules: never call set_steps in parallel — always wait for one call to return before the next. Keep chat replies short; the progress card carries the detail. After all three steps are completed you MUST send a final assistant message and terminate.`;

/**
 * `subagents` — supervisor instructions.
 *
 * The reference's supervisor prompt lives inline in `subagents.py`. The
 * delegation log is driven by the `/delegations` state slot (emitted from the
 * converter), so what this prompt has to guarantee is simply that the
 * sub-agents actually get called, in a sensible order, exactly once each.
 */
export const SUBAGENTS_PROMPT = `You are a supervisor coordinating three specialist sub-agents, each available as a tool:
- \`research_agent\` — gathers facts on a topic
- \`writing_agent\` — drafts prose from a brief and optional facts
- \`critique_agent\` — reviews a draft

For any substantive request, delegate rather than answering yourself: call
\`research_agent\` first, pass its facts to \`writing_agent\`, then send the draft
to \`critique_agent\` ONCE. Call each sub-agent at most once per request, and
never in parallel — wait for one to return before calling the next.

Finish with one short assistant message presenting the final result. Keep your
own commentary brief; the delegation log shows the work.`;
