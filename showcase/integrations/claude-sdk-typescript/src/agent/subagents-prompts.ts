/**
 * System prompts for the Sub-Agents demo.
 *
 * Mirrors the language used by the LangGraph Python and Google ADK
 * references (`langgraph-python/src/agents/subagents.py`,
 * `google-adk/src/agents/subagents_agent.py`) so the showcase produces
 * comparable output across runtimes.
 *
 * Each sub-agent is a *single Anthropic Messages API call* with a
 * dedicated system prompt — no tools, no recursion. The supervisor sees
 * each delegation as a tool call whose result is the sub-agent's reply.
 */

// @region[subagent-setup]
// Each sub-agent is defined by its own system prompt. The supervisor
// invokes them as tools; on each call the agent server issues a single
// Anthropic Messages API request with the matching prompt below. They
// don't share memory or tools with the supervisor — the supervisor only
// ever sees what the sub-agent returns as a tool result.
export const RESEARCH_SUBAGENT_SYSTEM =
  "You are a research sub-agent. Given a topic, produce a concise " +
  "bulleted list of 3-5 key facts. No preamble, no closing.";

export const WRITING_SUBAGENT_SYSTEM =
  "You are a writing sub-agent. Given a brief and optional source facts, " +
  "produce a polished 1-paragraph draft. Be clear and concrete. No preamble.";

export const CRITIQUE_SUBAGENT_SYSTEM =
  "You are an editorial critique sub-agent. Given a draft, give 2-3 crisp, " +
  "actionable critiques. No preamble.";

export const SUPERVISOR_SYSTEM_PROMPT =
  "You are a supervisor agent that coordinates three specialized " +
  "sub-agents to produce high-quality deliverables.\n\n" +
  "Available sub-agents (call them as tools):\n" +
  "  - research_agent: gathers facts on a topic.\n" +
  "  - writing_agent: turns facts + a brief into a polished draft.\n" +
  "  - critique_agent: reviews a draft and suggests improvements.\n\n" +
  "For most non-trivial user requests, delegate in sequence: research -> " +
  "write -> critique. Pass the relevant facts/draft through the `task` " +
  "argument of each tool. Each tool returns a JSON object shaped " +
  "`{status: 'completed' | 'failed', result?: string, error?: string}`. " +
  "If a sub-agent fails, surface the failure briefly to the user (don't " +
  "fabricate a result) and decide whether to retry. Keep your own " +
  "messages short — explain the plan once, delegate, then return a " +
  "concise summary once done. The UI shows the user a live log of " +
  "every sub-agent delegation, including the in-flight 'running' state.";

export type SubAgentName =
  | "research_agent"
  | "writing_agent"
  | "critique_agent";

export const SUBAGENT_SYSTEM_BY_NAME: Record<SubAgentName, string> = {
  research_agent: RESEARCH_SUBAGENT_SYSTEM,
  writing_agent: WRITING_SUBAGENT_SYSTEM,
  critique_agent: CRITIQUE_SUBAGENT_SYSTEM,
};
// @endregion[subagent-setup]

// @region[supervisor-delegation-tools]
// The supervisor delegates by calling tools. Each entry below is an
// Anthropic tool schema that the supervisor LLM "calls" to delegate
// work; the run loop in `agent_server.ts` runs the matching sub-agent
// synchronously, records the delegation into shared agent state, and
// returns the sub-agent's output as a tool_result the supervisor can
// read on its next step.
export const SUBAGENT_TOOL_SCHEMAS = [
  {
    name: "research_agent" as const,
    description:
      "Delegate a research task to the research sub-agent. Use for: " +
      "gathering facts, background, definitions, statistics. Returns a " +
      "JSON object {status, result?, error?}.",
    input_schema: {
      type: "object" as const,
      properties: {
        task: {
          type: "string",
          description: "The research task — a topic or question.",
        },
      },
      required: ["task"],
    },
  },
  {
    name: "writing_agent" as const,
    description:
      "Delegate a drafting task to the writing sub-agent. Use for: " +
      "producing a polished paragraph, draft, or summary. Pass relevant " +
      "facts from prior research inside `task`. Same return shape.",
    input_schema: {
      type: "object" as const,
      properties: {
        task: {
          type: "string",
          description:
            "The drafting brief — include any facts the writer should use.",
        },
      },
      required: ["task"],
    },
  },
  {
    name: "critique_agent" as const,
    description:
      "Delegate a critique task to the critique sub-agent. Use for: " +
      "reviewing a draft and suggesting concrete improvements. Same " +
      "return shape.",
    input_schema: {
      type: "object" as const,
      properties: {
        task: {
          type: "string",
          description: "The draft to critique.",
        },
      },
      required: ["task"],
    },
  },
];
// @endregion[supervisor-delegation-tools]
