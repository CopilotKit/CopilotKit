/**
 * LangGraph TypeScript agent backing the Shared State Streaming demo.
 *
 * Demonstrates per-token state-delta streaming. The agent writes a long
 * `document` string into shared agent state via a `write_document` tool;
 * `StateStreamingMiddleware(StateItem(...))` tells CopilotKit to forward
 * *every token* of the tool's `document` argument directly into the
 * `document` state key as it is generated. The UI (useAgent) sees
 * `state.document` grow token-by-token, without waiting for the tool call
 * to finish.
 *
 * This is the canonical per-token state-streaming pattern:
 * docs.copilotkit.ai/integrations/langgraph/shared-state/predictive-state-updates
 */

import { randomUUID } from "node:crypto";

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
// 1. Shared state — `document` is streamed token-by-token.
// ---------------------------------------------------------------------------

const AgentStateAnnotation = Annotation.Root({
  ...CopilotKitStateAnnotation.spec,
  document: Annotation<string>,
});

export type AgentState = typeof AgentStateAnnotation.State;

// ---------------------------------------------------------------------------
// 2. Tool — `write_document` writes the document into shared state.
// ---------------------------------------------------------------------------

// @region[write-document-tool]
const writeDocument = tool(
  async ({ document }, config: ToolRunnableConfig) => {
    const toolCallId = config.toolCall?.id;
    if (typeof toolCallId !== "string" || toolCallId.length === 0) {
      throw new Error(
        "write_document: missing tool_call_id — tool was invoked outside a " +
          "ToolNode context. Refusing to emit a ToolMessage with an empty " +
          "tool_call_id (OpenAI rejects those).",
      );
    }

    return new Command({
      update: {
        document,
        messages: [
          new ToolMessage({
            content: "Document written to shared state.",
            name: "write_document",
            id: randomUUID(),
            tool_call_id: toolCallId,
          }),
        ],
      },
    });
  },
  {
    name: "write_document",
    description:
      "Write a document for the user.\n\n" +
      "Always call this tool when the user asks you to write or draft " +
      "something of any length (an essay, poem, email, summary, etc.). " +
      "The `document` argument is streamed *per token* into shared agent " +
      "state under the `document` key, so the UI can render it as it is " +
      "generated.",
    schema: z.object({
      document: z.string(),
    }),
  },
);
// @endregion[write-document-tool]

const tools = [writeDocument];

// ---------------------------------------------------------------------------
// 3. Chat node.
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT =
  "You are a collaborative writing assistant. Whenever the user asks " +
  "you to write, draft, or revise any piece of text, ALWAYS call the " +
  "`write_document` tool with the full content as a single string in " +
  "the `document` argument. Never paste the document into a chat " +
  "message directly — the document belongs in shared state and the " +
  "UI renders it live as you type.";

async function chatNode(state: AgentState, config: RunnableConfig) {
  const model = new ChatOpenAI({ model: "gpt-5.4" });

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
