// @region[supervisor-delegation-tools]
// @region[subagent-setup]
import { z } from "zod4";
import { chat, toolDefinition } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import { BUILT_IN_AGENT_MODEL_FOR_TANSTACK } from "./models";
// Custom fetch that injects ALS-bound inbound x-* headers (e.g.
// x-aimock-context) onto every outbound OpenAI call. Required so aimock
// can match fixtures by integration context. See ../header-forwarding.ts
// for the full rationale; mirrors the Mastra precedent.
import { forwardingFetch } from "../header-forwarding";

// Each role becomes its own nested chat() with a dedicated system prompt.
// They don't share memory or tools with the supervisor — the supervisor
// only sees the role's return value via the delegate tool below.
//
// Tool names are part of the demo contract:
//   research_agent, writing_agent, critique_agent
// Keep them stable so the supervisor prompt, frontend renderers, and
// deterministic test fixtures all agree on the same delegation events.
const subagentRoles = [
  {
    id: "research_agent",
    systemPrompt:
      "You are a research sub-agent. Given a topic, produce a concise " +
      "bulleted list of 3-5 key facts. No preamble, no closing.",
  },
  {
    id: "writing_agent",
    systemPrompt:
      "You are a writing sub-agent. Given a brief and optional source " +
      "facts, produce a polished 1-paragraph draft. Be clear and " +
      "concrete. No preamble.",
  },
  {
    id: "critique_agent",
    systemPrompt:
      "You are an editorial critique sub-agent. Given a draft, give " +
      "2-3 crisp, actionable critiques. No preamble.",
  },
] as const;
// @endregion[subagent-setup]

// @region[subagent-tool-wrappers]
// Builder takes the parent run's AbortController so subagent `chat()` calls
// abort with the parent. Constructing tools at module-import time leaves them
// with their own fresh AbortController, which means a user cancel never reaches
// the in-flight subagent call — orphan async work, billed tokens, hung
// promises. Each parent run threads its controller through here.
// Each `<role>_agent` tool wraps a nested chat() call with the
// role's system prompt. The supervisor LLM "calls" these tools to
// delegate work; each invocation runs the matching subagent and returns
// its output for the supervisor's next step.
export function buildSubagentTools(parentAbortController: AbortController) {
  return subagentRoles.map((role) =>
    toolDefinition({
      name: role.id,
      description: `Delegate a task to the ${role.id.replace(/_/g, " ")}.`,
      inputSchema: z.object({
        task: z
          .string()
          .describe(`Task description for the ${role.id.replace(/_/g, " ")}`),
      }),
    }).server(async ({ task }) => {
      const text = await chat({
        adapter: openaiText(BUILT_IN_AGENT_MODEL_FOR_TANSTACK, {
          fetch: forwardingFetch,
        }),
        messages: [{ role: "user", content: task }],
        systemPrompts: [role.systemPrompt],
        abortController: parentAbortController,
        stream: false,
      });
      return { role: role.id, text };
    }),
  );
}
// @endregion[subagent-tool-wrappers]
// @endregion[supervisor-delegation-tools]
