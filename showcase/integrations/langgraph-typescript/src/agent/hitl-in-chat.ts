/**
 * LangGraph TypeScript agent backing the In-Chat HITL (useHumanInTheLoop) demo.
 *
 * The `book_call` tool is defined on the frontend via `useHumanInTheLoop`,
 * so there is no backend tool here. CopilotKit forwards the frontend tool
 * schemas to the agent at runtime via `state.copilotkit.actions`; the agent
 * binds them when invoking the model so the frontend-rendered time-picker
 * can resolve the call.
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
  "You help users book an onboarding call with the sales team. " +
  "When they ask to book a call, call the frontend-provided " +
  "`book_call` tool with a short topic and the user's name. " +
  "Keep any chat reply to one short sentence.";

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
