/**
 * LangGraph TypeScript agent backing the Readonly State (Agent Context) demo.
 *
 * Demonstrates the `useAgentContext` hook: the frontend provides READ-ONLY
 * context *to* the agent. This is the reverse direction of writable shared
 * state — the UI cannot be edited by the agent, but the agent reads this
 * context on every turn via CopilotKit's state forwarding.
 *
 * No custom state, no tools: this is the minimal shape of the
 * useAgentContext pattern. The agent just reads whatever context the
 * frontend registered and answers accordingly.
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
  "You are a helpful, concise assistant. The frontend may provide " +
  "read-only context about the user (e.g. name, timezone, recent " +
  "activity) via the `useAgentContext` hook. Always consult that " +
  "context when it is relevant — address the user by name if known, " +
  "respect their timezone when mentioning times, and reference " +
  "recent activity when it helps you answer. Keep responses short.";

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
