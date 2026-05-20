/**
 * LangGraph TypeScript agent backing the Frontend Tools (Async) demo.
 *
 * Demonstrates `useFrontendTool` with an ASYNC handler. The frontend
 * registers a `query_notes` tool whose handler awaits a simulated
 * client-side DB query (500ms latency) and returns matching notes. The
 * agent uses the returned result to summarize what it found.
 *
 * Like the sibling `frontend-tools` cell, the backend graph registers no
 * tools of its own — CopilotKit forwards the frontend tool schema(s) to
 * the agent at runtime, and the handler executes in the browser.
 */

import { RunnableConfig } from "@langchain/core/runnables";
import { SystemMessage } from "@langchain/core/messages";
import { MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import {
  convertActionsToDynamicStructuredTools,
  CopilotKitStateAnnotation,
} from "@copilotkit/sdk-js/langgraph";

const AgentStateAnnotation = CopilotKitStateAnnotation;
export type AgentState = typeof AgentStateAnnotation.State;

const SYSTEM_PROMPT =
  "You are a helpful assistant that can search the user's personal notes. " +
  "When the user asks about their notes, call the `query_notes` tool with " +
  "a concise keyword extracted from their request. The tool is provided " +
  "by the frontend at runtime and runs entirely in the user's browser — " +
  "you do not need to implement it yourself. After the tool returns, " +
  "summarize the matching notes clearly and concisely. If no notes match, " +
  "say so plainly and offer to try a different keyword.";

async function chatNode(state: AgentState, config: RunnableConfig) {
  const model = new ChatOpenAI({ temperature: 0, model: "gpt-4o-mini" });

  const modelWithTools = model.bindTools!([
    ...convertActionsToDynamicStructuredTools(state.copilotkit?.actions ?? []),
  ]);

  const response = await modelWithTools.invoke(
    [new SystemMessage({ content: SYSTEM_PROMPT }), ...state.messages],
    config,
  );

  return { messages: response };
}

const workflow = new StateGraph(AgentStateAnnotation)
  .addNode("chat_node", chatNode)
  .addEdge(START, "chat_node")
  .addEdge("chat_node", "__end__");

const memory = new MemorySaver();

export const graph = workflow.compile({
  checkpointer: memory,
});
