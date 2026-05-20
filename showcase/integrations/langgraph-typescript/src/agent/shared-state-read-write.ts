/**
 * LangGraph TypeScript agent backing the Shared State (Read + Write) demo.
 *
 * Demonstrates the full bidirectional shared-state pattern between UI and
 * agent:
 *
 * - **UI -> agent (write)**: The UI owns a `preferences` object (the user's
 *   profile) that it writes into agent state via `agent.setState(...)`. The
 *   chat node reads those preferences every turn and injects them into the
 *   system prompt, so the LLM adapts accordingly.
 * - **agent -> UI (read)**: The agent can call `set_notes` to update a
 *   `notes` slot in shared state via a `Command({ update: ... })`. The UI
 *   reflects every update in real time via `useAgent(...)`.
 *
 * Together this shows the canonical LangGraph TypeScript bidirectional
 * shared state: frontend writes, backend reads AND writes, frontend
 * re-renders.
 *
 * Ported from `src/agents/shared_state_read_write.py` in the
 * langgraph-python sibling package.
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
// 1. Shared state — bidirectional channel between UI and agent.
//
// `preferences` is WRITTEN by the UI via `agent.setState(...)` and READ by
// the chat node every turn (it's injected into the system prompt).
//
// `notes` is WRITTEN by the agent via the `set_notes` tool's `Command`
// update, and READ by the UI via `useAgent({ updates: [OnStateChanged] })`.
// ---------------------------------------------------------------------------

export interface Preferences {
  name?: string;
  tone?: "formal" | "casual" | "playful";
  language?: string;
  interests?: string[];
}

const AgentStateAnnotation = Annotation.Root({
  ...CopilotKitStateAnnotation.spec,
  preferences: Annotation<Preferences | undefined>,
  notes: Annotation<string[]>,
});

export type AgentState = typeof AgentStateAnnotation.State;

// ---------------------------------------------------------------------------
// 2. Tool — `set_notes` writes the agent-authored notes slot.
//
// Returns a `Command({ update: ... })` so we can BOTH emit a ToolMessage
// (the LLM sees a well-formed tool result on the next turn) AND mutate
// the `notes` channel (the UI re-renders from shared state).
// ---------------------------------------------------------------------------

// @region[set-notes-tool]
const setNotes = tool(
  async ({ notes }, config: ToolRunnableConfig) => {
    const toolCallId = config.toolCall?.id;
    if (typeof toolCallId !== "string" || toolCallId.length === 0) {
      throw new Error(
        "set_notes: missing tool_call_id — tool was invoked outside a " +
          "ToolNode context. Refusing to emit a ToolMessage with an empty " +
          "tool_call_id (OpenAI rejects those).",
      );
    }

    return new Command({
      update: {
        notes,
        messages: [
          new ToolMessage({
            status: "success",
            name: "set_notes",
            tool_call_id: toolCallId,
            content: "Notes updated.",
          }),
        ],
      },
    });
  },
  {
    name: "set_notes",
    description:
      "Replace the notes array in shared state with the full updated list. " +
      "Use this tool whenever the user asks you to 'remember' something, or " +
      "when you have an observation about the user worth surfacing in the " +
      "UI's notes panel. Always pass the FULL notes list (existing notes + " +
      "any new ones), not a diff. Keep each note short (< 120 chars).",
    schema: z.object({
      notes: z
        .array(z.string())
        .describe("The full updated notes list (replaces previous value)."),
    }),
  },
);
// @endregion[set-notes-tool]

const tools = [setNotes];

// ---------------------------------------------------------------------------
// 3. Preferences-injecting chat node.
//
// Equivalent to the Python `PreferencesInjectorMiddleware`: every turn we
// read the latest `preferences` from agent state and prepend a
// SystemMessage that tells the LLM about them. This is how UI-written
// state becomes visible to the agent.
// ---------------------------------------------------------------------------

const BASE_SYSTEM_PROMPT =
  "You are a helpful, concise assistant. " +
  "The user's preferences are supplied via shared state and will be " +
  "added as a system message at the start of every turn. Always " +
  "respect them. " +
  "When the user asks you to remember something, or when you observe " +
  "something worth surfacing in the UI, call `set_notes` with the " +
  "FULL updated list of short note strings (existing notes + new).";

// @region[preferences-injector]
function buildPreferencesMessage(
  prefs: Preferences | undefined,
): SystemMessage | null {
  if (!prefs) return null;
  const lines: string[] = [];
  if (prefs.name) lines.push(`- Name: ${prefs.name}`);
  if (prefs.tone) lines.push(`- Preferred tone: ${prefs.tone}`);
  if (prefs.language) lines.push(`- Preferred language: ${prefs.language}`);
  if (prefs.interests && prefs.interests.length > 0) {
    lines.push(`- Interests: ${prefs.interests.join(", ")}`);
  }
  if (lines.length === 0) return null;
  return new SystemMessage({
    content: [
      "The user has shared these preferences with you:",
      ...lines,
      "Tailor every response to these preferences. Address the user by " +
        "name when appropriate.",
    ].join("\n"),
  });
}
// @endregion[preferences-injector]

async function chatNode(state: AgentState, config: RunnableConfig) {
  const model = new ChatOpenAI({ temperature: 0, model: "gpt-4o-mini" });

  const modelWithTools = model.bindTools!([
    ...convertActionsToDynamicStructuredTools(state.copilotkit?.actions ?? []),
    ...tools,
  ]);

  const baseSystem = new SystemMessage({ content: BASE_SYSTEM_PROMPT });
  const prefsMessage = buildPreferencesMessage(state.preferences);

  const systemMessages = prefsMessage
    ? [baseSystem, prefsMessage]
    : [baseSystem];

  const response = await modelWithTools.invoke(
    [...systemMessages, ...state.messages],
    config,
  );

  return { messages: response };
}

// ---------------------------------------------------------------------------
// 4. Routing — send tool calls to tool_node unless they're CopilotKit
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
// 5. Compile the graph.
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
});
