/**
 * LangGraph TypeScript agent backing the Gen UI (Agent-based) demo.
 *
 * Demonstrates explicit agent state + a state-editing tool. The agent
 * plans a task as 3 steps and walks each pending -> in_progress ->
 * completed, calling `set_steps` after every transition. The frontend
 * subscribes to `state.steps` via `useAgent` and renders a live progress
 * card.
 *
 * Ported from `src/agents/gen_ui_agent.py` in the langgraph-python
 * sibling package.
 */

import { z } from "zod";
import { RunnableConfig } from "@langchain/core/runnables";
import { tool } from "@langchain/core/tools";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import {
  AIMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import type { ToolRunnableConfig } from "@langchain/core/tools";
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
// 1. Shared state — `steps` is rendered as a live progress card in the UI.
// ---------------------------------------------------------------------------

const StepSchema = z.object({
  id: z.string().describe("Unique identifier for the step."),
  title: z.string().describe("Short description of the step."),
  status: z
    .enum(["pending", "in_progress", "completed"])
    .describe("Current status of the step."),
});

export type Step = z.infer<typeof StepSchema>;

const AgentStateAnnotation = Annotation.Root({
  ...CopilotKitStateAnnotation.spec,
  // Last-write-wins reducer: each set_steps call replaces the full list.
  steps: Annotation<Step[]>({
    reducer: (_prev, next) => (next != null ? next : (_prev ?? [])),
    default: () => [],
  }),
});

export type AgentState = typeof AgentStateAnnotation.State;

// ---------------------------------------------------------------------------
// 2. Tool — `set_steps` publishes the current plan + step statuses.
//
// Returns a `Command({ update: ... })` so we can BOTH emit a ToolMessage
// (the LLM sees a well-formed tool result on the next turn) AND mutate
// the `steps` channel (the UI re-renders from shared state).
// ---------------------------------------------------------------------------

const setSteps = tool(
  async ({ steps }, config: ToolRunnableConfig) => {
    const toolCallId = config.toolCall?.id;
    if (typeof toolCallId !== "string" || toolCallId.length === 0) {
      throw new Error(
        "set_steps: missing tool_call_id — tool was invoked outside a " +
          "ToolNode context. Refusing to emit a ToolMessage with an empty " +
          "tool_call_id (OpenAI rejects those).",
      );
    }

    return new Command({
      update: {
        steps,
        messages: [
          new ToolMessage({
            status: "success",
            name: "set_steps",
            tool_call_id: toolCallId,
            content: `Published ${steps.length} step(s).`,
          }),
        ],
      },
    });
  },
  {
    name: "set_steps",
    description:
      "Publish the current plan + step statuses. Call this every time a " +
      "step transitions (including the first enumeration of steps).",
    schema: z.object({
      steps: z
        .array(StepSchema)
        .describe("The full list of steps with their current statuses."),
    }),
  },
);

const tools = [setSteps];

// ---------------------------------------------------------------------------
// 3. System prompt — matches the LGP agent's instruction sequence.
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT =
  "You are an agentic planner. For each user request, follow this exact " +
  "sequence:\n" +
  "1. Plan exactly 3 concrete steps and call `set_steps` ONCE with all " +
  'three steps at status="pending".\n' +
  '2. Step 1: call `set_steps` with step 1 at status="in_progress", ' +
  'then call `set_steps` again with step 1 at status="completed".\n' +
  '3. Step 2: call `set_steps` with step 2 at status="in_progress", ' +
  'then call `set_steps` again with step 2 at status="completed".\n' +
  '4. Step 3: call `set_steps` with step 3 at status="in_progress", ' +
  'then call `set_steps` again with step 3 at status="completed".\n' +
  "5. Send ONE final conversational assistant message summarizing the " +
  "plan, then stop. Do not call any more tools after step 3 is " +
  "completed.\n" +
  "\n" +
  "Rules: never call set_steps in parallel — always wait for one call to " +
  "return before the next. After all three steps are completed you MUST " +
  "send a final assistant message and terminate.";

// ---------------------------------------------------------------------------
// 4. Chat node.
// ---------------------------------------------------------------------------

async function chatNode(state: AgentState, config: RunnableConfig) {
  const model = new ChatOpenAI({ temperature: 0, model: "gpt-4o-mini" });

  const modelWithTools = model.bindTools!([
    ...convertActionsToDynamicStructuredTools(state.copilotkit?.actions ?? []),
    ...tools,
  ]);

  const response = await modelWithTools.invoke(
    [new SystemMessage({ content: SYSTEM_PROMPT }), ...state.messages],
    config,
  );

  return { messages: response };
}

// ---------------------------------------------------------------------------
// 5. Routing — send tool calls to tool_node unless they're CopilotKit
//    frontend actions.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 6. Compile the graph.
//
// The prompt drives ~7 set_steps cycles + 1 final model turn, so nominal
// cost is ~15 supersteps. recursion_limit=50 gives ~3x headroom for
// retries inside the LLM loop.
// ---------------------------------------------------------------------------

const workflow = new StateGraph(AgentStateAnnotation)
  .addNode("chat_node", chatNode)
  .addNode("tool_node", new ToolNode(tools))
  .addEdge(START, "chat_node")
  .addEdge("tool_node", "chat_node")
  .addConditionalEdges("chat_node", shouldContinue as any);

const memory = new MemorySaver();

export const graph = workflow.compile({
  checkpointer: memory,
  recursionLimit: 50,
});
