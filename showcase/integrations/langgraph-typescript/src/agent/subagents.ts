/**
 * LangGraph TypeScript agent backing the Sub-Agents demo.
 *
 * Demonstrates multi-agent delegation with a visible delegation log.
 *
 * A top-level "supervisor" LLM orchestrates three specialized sub-agents,
 * exposed as tools:
 *
 *   - `research_agent` — gathers facts
 *   - `writing_agent`  — drafts prose
 *   - `critique_agent` — reviews drafts
 *
 * Each sub-agent is a small purpose-built `ChatOpenAI` invocation with
 * its own system prompt. Every delegation appends an entry to the
 * `delegations` slot in shared agent state so the UI can render a live
 * "delegation log" as the supervisor fans work out and collects results.
 *
 * Ported from `src/agents/subagents.py` in the langgraph-python sibling
 * package.
 */

// @region[supervisor-delegation-tools]
// @region[subagent-setup]
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { RunnableConfig } from "@langchain/core/runnables";
import { tool } from "@langchain/core/tools";
import type { ToolRunnableConfig } from "@langchain/core/tools";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import {
  Annotation,
  Command,
  MemorySaver,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import {
  convertActionsToDynamicStructuredTools,
  CopilotKitStateAnnotation,
} from "@copilotkit/sdk-js/langgraph";

// ---------------------------------------------------------------------------
// 1. Shared state — `delegations` is rendered as a live log in the UI.
// ---------------------------------------------------------------------------

export type SubAgentName =
  | "research_agent"
  | "writing_agent"
  | "critique_agent";

export interface Delegation {
  id: string;
  sub_agent: SubAgentName;
  task: string;
  status: "running" | "completed" | "failed";
  result: string;
}

const AgentStateAnnotation = Annotation.Root({
  ...CopilotKitStateAnnotation.spec,
  // Use a list-extending reducer so parallel tool_calls in a single
  // assistant turn don't clobber each other. Without this, each tool
  // callback's Command runs against the same task-input snapshot, and the
  // channel reducer (last-write-wins by default) silently drops every
  // delegation but one.
  delegations: Annotation<Delegation[]>({
    reducer: (a, b) => [...(a ?? []), ...(b ?? [])],
    default: () => [],
  }),
});

export type AgentState = typeof AgentStateAnnotation.State;

// ---------------------------------------------------------------------------
// 2. Sub-agents (small purpose-built LLM invocations).
//
// Each sub-agent has its own system prompt and is invoked synchronously
// from inside the matching supervisor tool. They don't share memory or
// tools with the supervisor — the supervisor only sees their return
// value.
// ---------------------------------------------------------------------------

const SUB_MODEL = new ChatOpenAI({ temperature: 0, model: "gpt-4o-mini" });

const SUB_AGENT_PROMPTS: Record<SubAgentName, string> = {
  research_agent:
    "You are a research sub-agent. Given a topic, produce a concise " +
    "bulleted list of 3-5 key facts. No preamble, no closing.",
  writing_agent:
    "You are a writing sub-agent. Given a brief and optional source " +
    "facts, produce a polished 1-paragraph draft. Be clear and " +
    "concrete. No preamble.",
  critique_agent:
    "You are an editorial critique sub-agent. Given a draft, give " +
    "2-3 crisp, actionable critiques. No preamble.",
};

async function invokeSubAgent(
  agent: SubAgentName,
  task: string,
): Promise<string> {
  const result = await SUB_MODEL.invoke([
    new SystemMessage({ content: SUB_AGENT_PROMPTS[agent] }),
    new HumanMessage({ content: task }),
  ]);
  const content = (result as AIMessage).content;
  if (typeof content === "string") return content;
  // Content is sometimes a list of parts — flatten any text parts.
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "string"
          ? part
          : "text" in (part as Record<string, unknown>)
            ? String((part as { text?: unknown }).text ?? "")
            : "",
      )
      .join("");
  }
  return String(content ?? "");
}
// @endregion[subagent-setup]

// ---------------------------------------------------------------------------
// 3. Helper — emit a single delegation entry plus a ToolMessage.
//
// The `delegations` channel uses a list-extending reducer (see
// AgentStateAnnotation above) so each Command emits ONLY the new entry —
// parallel tool_calls in one assistant turn each contribute their entry
// and the reducer concatenates them. Emitting the full list here would
// cause duplicates under the new reducer.
// ---------------------------------------------------------------------------

function delegationUpdate(
  subAgent: SubAgentName,
  task: string,
  result: string,
  toolCallId: string,
  status: "completed" | "failed" = "completed",
): Command {
  const entry: Delegation = {
    id: randomUUID(),
    sub_agent: subAgent,
    task,
    status,
    result,
  };
  return new Command({
    update: {
      delegations: [entry],
      messages: [
        new ToolMessage({
          status: status === "completed" ? "success" : "error",
          name: subAgent,
          tool_call_id: toolCallId,
          content: result,
        }),
      ],
    },
  });
}

// Run a sub-agent and return either its output or a scrubbed failure
// message. A thrown error inside a delegation tool would otherwise
// propagate and crash the supervisor turn — the user sees a runtime
// error and no `failed` entry ever lands in the delegation log. Catch
// here so the supervisor can keep working and the UI can render the
// failed delegation just like a successful one.
async function runSubAgentSafely(
  agent: SubAgentName,
  task: string,
): Promise<{ ok: true; result: string } | { ok: false; result: string }> {
  try {
    const result = await invokeSubAgent(agent, task);
    return { ok: true, result };
  } catch (err) {
    const errName = err instanceof Error ? err.constructor.name : typeof err;
    console.error(`[subagents] ${agent} sub-agent invocation failed:`, err);
    return {
      ok: false,
      result: `sub-agent call failed: ${errName} (see server logs)`,
    };
  }
}

function requireToolCallId(
  config: ToolRunnableConfig,
  toolName: string,
): string {
  const toolCallId = config.toolCall?.id;
  if (typeof toolCallId !== "string" || toolCallId.length === 0) {
    throw new Error(
      `${toolName}: missing tool_call_id on ToolRunnableConfig.toolCall — ` +
        "tool was invoked outside a ToolNode context.",
    );
  }
  return toolCallId;
}

// ---------------------------------------------------------------------------
// 4. Supervisor tools — each tool delegates to one sub-agent.
//
// The supervisor LLM "calls" these tools to delegate work; each call
// synchronously runs the matching sub-agent, records the delegation
// into shared state, and returns the sub-agent's output as a
// ToolMessage the supervisor can read on its next step.
// ---------------------------------------------------------------------------

const researchAgentTool = tool(
  async ({ task }, config: ToolRunnableConfig) => {
    const toolCallId = requireToolCallId(config, "research_agent");
    const outcome = await runSubAgentSafely("research_agent", task);
    return delegationUpdate(
      "research_agent",
      task,
      outcome.result,
      toolCallId,
      outcome.ok ? "completed" : "failed",
    );
  },
  {
    name: "research_agent",
    description:
      "Delegate a research task to the research sub-agent. " +
      "Use for: gathering facts, background, definitions, statistics. " +
      "Returns a bulleted list of key facts.",
    schema: z.object({
      task: z
        .string()
        .describe("The research question or topic to investigate."),
    }),
  },
);

const writingAgentTool = tool(
  async ({ task }, config: ToolRunnableConfig) => {
    const toolCallId = requireToolCallId(config, "writing_agent");
    const outcome = await runSubAgentSafely("writing_agent", task);
    return delegationUpdate(
      "writing_agent",
      task,
      outcome.result,
      toolCallId,
      outcome.ok ? "completed" : "failed",
    );
  },
  {
    name: "writing_agent",
    description:
      "Delegate a drafting task to the writing sub-agent. " +
      "Use for: producing a polished paragraph, draft, or summary. Pass " +
      "relevant facts from prior research inside `task`.",
    schema: z.object({
      task: z
        .string()
        .describe(
          "Brief + optional source facts. The sub-agent returns a 1-paragraph draft.",
        ),
    }),
  },
);

const critiqueAgentTool = tool(
  async ({ task }, config: ToolRunnableConfig) => {
    const toolCallId = requireToolCallId(config, "critique_agent");
    const outcome = await runSubAgentSafely("critique_agent", task);
    return delegationUpdate(
      "critique_agent",
      task,
      outcome.result,
      toolCallId,
      outcome.ok ? "completed" : "failed",
    );
  },
  {
    name: "critique_agent",
    description:
      "Delegate a critique task to the critique sub-agent. " +
      "Use for: reviewing a draft and suggesting concrete improvements.",
    schema: z.object({
      task: z
        .string()
        .describe(
          "The draft to critique. The sub-agent returns 2-3 critiques.",
        ),
    }),
  },
);
// @endregion[supervisor-delegation-tools]

const tools = [researchAgentTool, writingAgentTool, critiqueAgentTool];

// ---------------------------------------------------------------------------
// 5. Supervisor chat node.
// ---------------------------------------------------------------------------

const SUPERVISOR_SYSTEM_PROMPT =
  "You are a supervisor agent that coordinates three specialized " +
  "sub-agents to produce high-quality deliverables.\n\n" +
  "Available sub-agents (call them as tools):\n" +
  "  - research_agent: gathers facts on a topic.\n" +
  "  - writing_agent: turns facts + a brief into a polished draft.\n" +
  "  - critique_agent: reviews a draft and suggests improvements.\n\n" +
  "For most non-trivial user requests, delegate in sequence: " +
  "research -> write -> critique. Pass the relevant facts/draft " +
  "through the `task` argument of each tool. Keep your own " +
  "messages short — explain the plan once, delegate, then return " +
  "a concise summary once done. The UI shows the user a live log " +
  "of every sub-agent delegation.";

async function chatNode(state: AgentState, config: RunnableConfig) {
  const model = new ChatOpenAI({ temperature: 0, model: "gpt-4o-mini" });

  const modelWithTools = model.bindTools!([
    ...convertActionsToDynamicStructuredTools(state.copilotkit?.actions ?? []),
    ...tools,
  ]);

  const response = await modelWithTools.invoke(
    [
      new SystemMessage({ content: SUPERVISOR_SYSTEM_PROMPT }),
      ...state.messages,
    ],
    config,
  );

  return { messages: response };
}

function shouldContinue({ messages, copilotkit }: AgentState) {
  const lastMessage = messages[messages.length - 1] as AIMessage;

  if (lastMessage.tool_calls?.length) {
    const actions = copilotkit?.actions;
    const toolCallName = lastMessage.tool_calls![0].name;

    if (!actions || actions.every((action) => action.name !== toolCallName)) {
      return "tool_node";
    }
  }

  return "__end__";
}

const workflow = new StateGraph(AgentStateAnnotation)
  .addNode("chat_node", chatNode)
  .addNode("tool_node", new ToolNode(tools))
  .addEdge(START, "chat_node")
  .addEdge("tool_node", "chat_node")
  .addConditionalEdges("chat_node", shouldContinue as any);

const memory = new MemorySaver();

export const graph = workflow.compile({
  checkpointer: memory,
});
