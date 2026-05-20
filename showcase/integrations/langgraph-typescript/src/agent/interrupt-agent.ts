/**
 * LangGraph TypeScript agent for the Interrupt-based Generative UI demos.
 *
 * Defines a backend tool `schedule_meeting(topic, attendee)` that uses
 * langgraph's `interrupt()` primitive to pause the run and surface the
 * meeting context to the frontend. The frontend `useInterrupt` renderer
 * shows a time picker and resolves with `{chosen_time, chosen_label}` or
 * `{cancelled: true}`, which this tool turns into a human-readable result.
 *
 * Ported from `src/agents/interrupt_agent.py` in the langgraph-python package.
 */

// @region[backend-interrupt-tool]
import { z } from "zod";
import type { RunnableConfig } from "@langchain/core/runnables";
import { tool } from "@langchain/core/tools";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import type { AIMessage } from "@langchain/core/messages";
import { SystemMessage } from "@langchain/core/messages";
import {
  MemorySaver,
  START,
  StateGraph,
  Annotation,
  interrupt,
} from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import {
  convertActionsToDynamicStructuredTools,
  CopilotKitStateAnnotation,
} from "@copilotkit/sdk-js/langgraph";

// Demo-only fixed timezone offset (Pacific = UTC-7 in PDT, UTC-8 in PST).
// A real app would use the user's calendar + locale; we hardcode Pacific so
// screenshots are stable. Mirrors interrupt_agent.py.
const DEMO_TZ_OFFSET_HOURS = -7; // PDT

interface TimeSlot {
  label: string;
  iso: string;
}

function candidateSlots(): TimeSlot[] {
  const now = new Date();
  // "Tomorrow"
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  // "Monday" — at least 2 days away to avoid collisions with "Tomorrow"
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  let daysToMonday = (1 - dayOfWeek + 7) % 7;
  if (daysToMonday <= 1) daysToMonday += 7;
  const nextMonday = new Date(now);
  nextMonday.setDate(now.getDate() + daysToMonday);

  const fmt = (d: Date, hour: number, minute = 0): string => {
    // Build an ISO-like string with the demo timezone offset
    const sign = DEMO_TZ_OFFSET_HOURS >= 0 ? "+" : "-";
    const absOffset = Math.abs(DEMO_TZ_OFFSET_HOURS);
    const hh = String(absOffset).padStart(2, "0");
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00${sign}${hh}:00`;
  };

  return [
    { label: "Tomorrow 10:00 AM", iso: fmt(tomorrow, 10) },
    { label: "Tomorrow 2:00 PM", iso: fmt(tomorrow, 14) },
    { label: "Monday 9:00 AM", iso: fmt(nextMonday, 9) },
    { label: "Monday 3:30 PM", iso: fmt(nextMonday, 15, 30) },
  ];
}

const SYSTEM_PROMPT =
  "You are a scheduling assistant. Whenever the user asks you to book a " +
  "call / schedule a meeting, you MUST call the `schedule_meeting` tool. " +
  "Pass a short `topic` describing the purpose and `attendee` describing " +
  "who the meeting is with. After the tool returns, confirm briefly " +
  "whether the meeting was scheduled and at what time, or that the user " +
  "cancelled.";

const AgentStateAnnotation = Annotation.Root({
  ...CopilotKitStateAnnotation.spec,
});

export type AgentState = typeof AgentStateAnnotation.State;

const scheduleMeeting = tool(
  async ({ topic, attendee }: { topic: string; attendee?: string | null }) => {
    // langgraph's `interrupt()` pauses execution and forwards the payload to
    // the client. The frontend v2 `useInterrupt` hook renders the picker and
    // calls `resolve(...)` with the user's selection, which comes back here.
    const response: unknown = interrupt({
      topic,
      attendee: attendee ?? null,
      slots: candidateSlots(),
    });

    if (response && typeof response === "object") {
      const resp = response as Record<string, unknown>;
      if (resp.cancelled) {
        return `User cancelled. Meeting NOT scheduled: ${topic}`;
      }
      const chosenLabel =
        (resp.chosen_label as string | undefined) ??
        (resp.chosen_time as string | undefined);
      if (chosenLabel) {
        return `Meeting scheduled for ${chosenLabel}: ${topic}`;
      }
    }

    return `User did not pick a time. Meeting NOT scheduled: ${topic}`;
  },
  {
    name: "schedule_meeting",
    description:
      "Ask the user to pick a time slot for a call, via an in-chat picker.",
    schema: z.object({
      topic: z
        .string()
        .describe("Short human-readable description of the call's purpose."),
      attendee: z
        .string()
        .nullable()
        .optional()
        .describe("Who the call is with (optional)."),
    }),
  },
);
// @endregion[backend-interrupt-tool]

const tools = [scheduleMeeting];

async function chatNode(state: AgentState, config: RunnableConfig) {
  const model = new ChatOpenAI({ temperature: 0, model: "gpt-4o-mini" });

  const modelWithTools = model.bindTools!([
    ...convertActionsToDynamicStructuredTools(state.copilotkit?.actions ?? []),
    ...tools,
  ]);

  const systemMessage = new SystemMessage({ content: SYSTEM_PROMPT });

  const response = await modelWithTools.invoke(
    [systemMessage, ...state.messages],
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
