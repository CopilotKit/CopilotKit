// @region[supervisor-delegation-tools]
// @region[subagent-setup]
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { openai } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";
import crypto from "node:crypto";
import { writeDelegationsToWorkingMemory } from "./working-memory";

// Each sub-agent is a full Mastra `Agent` with its own system prompt. They
// don't share memory or tools with the supervisor — the supervisor only sees
// their final text output via the tools below. Mirrors the LangGraph-Python
// `subagents.py` reference where each sub-agent is a `create_agent(...)`.
const SUBAGENT_MODEL = openai("gpt-4o-mini");

const researchSubAgent = new Agent({
  id: "research-subagent",
  name: "Research Subagent",
  model: SUBAGENT_MODEL,
  instructions:
    "You are a research sub-agent. Given a topic, produce a concise " +
    "bulleted list of 3-5 key facts. No preamble, no closing.",
});

const writingSubAgent = new Agent({
  id: "writing-subagent",
  name: "Writing Subagent",
  model: SUBAGENT_MODEL,
  instructions:
    "You are a writing sub-agent. Given a brief and optional source " +
    "facts, produce a polished 1-paragraph draft. Be clear and concrete. " +
    "No preamble.",
});

const critiqueSubAgent = new Agent({
  id: "critique-subagent",
  name: "Critique Subagent",
  model: SUBAGENT_MODEL,
  instructions:
    "You are an editorial critique sub-agent. Given a draft, give 2-3 " +
    "crisp, actionable critiques. No preamble.",
});
// @endregion[subagent-setup]

/**
 * Result of invoking a sub-agent. Discriminated so the wrapping tools can map
 * success/failure into the correct delegation `status` for the UI without
 * relying on string-matching the `result` field. We deliberately do NOT
 * surface raw `err.message` to the LLM/UI: error messages from upstream APIs
 * routinely leak api keys, file paths, and prompt contents. Mirror the
 * agno / claude-sdk-python pattern of redacting to the error class name.
 */
type SubAgentResult = { ok: true; text: string } | { ok: false; error: string };

async function invokeSubAgent(
  agent: Agent,
  task: string,
): Promise<SubAgentResult> {
  // Mastra Agent.generate returns an object with a `.text` field for the
  // final assistant text. We catch internally so a sub-agent failure becomes
  // a visible failed delegation entry rather than crashing the supervisor.
  try {
    const result = await agent.generate(task);
    const text = (result as { text?: unknown }).text;
    return {
      ok: true,
      text: typeof text === "string" && text.length > 0 ? text : "",
    };
  } catch (err) {
    // Redact: only the error class name reaches the LLM and the UI. The full
    // `err.message` (which can contain provider keys, file paths, or echoed
    // prompts) stays in the server log below.
    const errorClass =
      err instanceof Error ? err.constructor.name : "UnknownError";
    console.error(
      JSON.stringify({
        at: new Date().toISOString(),
        level: "error",
        component: "subagents",
        agentId: agent.id,
        errorClass,
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      }),
    );
    return { ok: false, error: errorClass };
  }
}

/**
 * Delegate a research task to the research sub-agent.
 *
 * The supervisor LLM "calls" this tool to fan a research subtask out. The
 * tool synchronously runs the matching Mastra sub-agent and returns a
 * `Delegation` entry. The supervisor is instructed to APPEND this entry to
 * the `delegations` array in working memory so the UI's live delegation log
 * picks it up via the AG-UI state-snapshot channel.
 */
type SubAgentName = "research_agent" | "writing_agent" | "critique_agent";

/**
 * Build the delegation entry + tool-result payload from a SubAgentResult.
 *
 * Status mapping rules (the whole point of `SubAgentResult`):
 *   - ok: true  → status = "completed", result = sub-agent text output
 *   - ok: false → status = "failed",    result = "[sub-agent error] <ErrorClass>"
 *
 * Without this discrimination, a sub-agent that throws renders as a green
 * "completed" entry in the UI's delegation log — a UX lie the supervisor LLM
 * cannot detect either, since it sees the same green payload. Surfacing the
 * redacted error class through the `result` field lets the supervisor decide
 * to retry or fall back, without leaking provider-side internals.
 */
function buildDelegationPayload(
  subAgentName: SubAgentName,
  task: string,
  result: SubAgentResult,
): { delegation: Record<string, unknown>; resultText: string } {
  const resultText = result.ok
    ? result.text
    : `[sub-agent error] ${result.error}`;
  const delegation = {
    id: crypto.randomUUID(),
    sub_agent: subAgentName,
    task,
    status: result.ok ? ("completed" as const) : ("failed" as const),
    result: resultText,
  };
  return { delegation, resultText };
}

export const researchAgentTool = createTool({
  id: "research_agent",
  description:
    "Delegate a research task to the research sub-agent. Use for: " +
    "gathering facts, background, definitions, statistics. Returns a " +
    "bulleted list of key facts. The delegation is also recorded directly " +
    "in working memory by the tool itself — you do not need to (and " +
    "should not) re-emit the delegation object.",
  inputSchema: z.object({
    task: z.string().describe("The research task / topic to investigate."),
  }),
  execute: async (inputData, executionContext) => {
    const task = inputData.task ?? "";
    const result = await invokeSubAgent(researchSubAgent, task);
    const { delegation, resultText } = buildDelegationPayload(
      "research_agent",
      task,
      result,
    );
    await writeDelegationsToWorkingMemory(executionContext, delegation);
    return JSON.stringify({ result: resultText, delegation });
  },
});

export const writingAgentTool = createTool({
  id: "writing_agent",
  description:
    "Delegate a drafting task to the writing sub-agent. Use for: producing " +
    "a polished paragraph, draft, or summary. Pass relevant facts from " +
    "prior research inside `task`. Returns the draft. The delegation is " +
    "also recorded directly in working memory by the tool itself.",
  inputSchema: z.object({
    task: z
      .string()
      .describe(
        "The drafting brief, including any facts the writer should incorporate.",
      ),
  }),
  execute: async (inputData, executionContext) => {
    const task = inputData.task ?? "";
    const result = await invokeSubAgent(writingSubAgent, task);
    const { delegation, resultText } = buildDelegationPayload(
      "writing_agent",
      task,
      result,
    );
    await writeDelegationsToWorkingMemory(executionContext, delegation);
    return JSON.stringify({ result: resultText, delegation });
  },
});

export const critiqueAgentTool = createTool({
  id: "critique_agent",
  description:
    "Delegate a critique task to the critique sub-agent. Use for: " +
    "reviewing a draft and suggesting concrete improvements. Returns the " +
    "critique. The delegation is also recorded directly in working memory " +
    "by the tool itself.",
  inputSchema: z.object({
    task: z
      .string()
      .describe(
        "The draft to critique, plus any specific critique focus you want.",
      ),
  }),
  execute: async (inputData, executionContext) => {
    const task = inputData.task ?? "";
    const result = await invokeSubAgent(critiqueSubAgent, task);
    const { delegation, resultText } = buildDelegationPayload(
      "critique_agent",
      task,
      result,
    );
    await writeDelegationsToWorkingMemory(executionContext, delegation);
    return JSON.stringify({ result: resultText, delegation });
  },
});
// @endregion[supervisor-delegation-tools]
