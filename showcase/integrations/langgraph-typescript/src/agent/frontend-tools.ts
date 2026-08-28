/**
 * LangGraph TypeScript agent backing the Frontend Tools (In-App Actions) demo.
 *
 * The demo is about frontend tools — the agent has no custom backend tools.
 * CopilotKit forwards the frontend tool schemas to the agent at runtime via
 * `state.copilotkit.actions`; the agent binds them when invoking the model,
 * and the handler executes in the browser.
 */

import { makeChatOpenAI } from "./openai-headers";

// region: setup
import type { RunnableConfig } from "@langchain/core/runnables";
import { SystemMessage } from "@langchain/core/messages";
import { MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import {
  convertActionsToDynamicStructuredTools,
  CopilotKitStateAnnotation,
} from "@copilotkit/sdk-js/langgraph";

// CopilotKit forwards frontend tools to the agent via
// `state.copilotkit.actions`. `CopilotKitStateAnnotation` adds that
// channel to your graph's state; `convertActionsToDynamicStructuredTools`
// turns the forwarded action schemas into LangChain tools you can bind
// at model-invocation time.
const AgentStateAnnotation = CopilotKitStateAnnotation;
export type AgentState = typeof AgentStateAnnotation.State;

const SYSTEM_PROMPT = "You are a helpful, concise assistant.";

async function runChatNode(
  state: AgentState,
  config: RunnableConfig,
  model: ChatOpenAI,
) {
  const modelWithTools = model.bindTools!([
    ...convertActionsToDynamicStructuredTools(state.copilotkit?.actions ?? []),
  ]);

  const response = await modelWithTools.invoke(
    [new SystemMessage({ content: SYSTEM_PROMPT }), ...state.messages],
    config,
  );

  return { messages: response };
}

async function chatNode(state: AgentState, config: RunnableConfig) {
  return runChatNode(
    state,
    config,
    new ChatOpenAI({ temperature: 0, model: "gpt-4o-mini" }),
  );
}

function compileGraph(node: typeof chatNode) {
  return new StateGraph(AgentStateAnnotation)
    .addNode("chat_node", node)
    .addEdge(START, "chat_node")
    .addEdge("chat_node", "__end__")
    .compile({ checkpointer: new MemorySaver() });
}

export const graph = compileGraph(chatNode);
// endregion

// The LangGraph CLI targets this export so showcase probes retain inbound
// x-* header forwarding; the public `graph` above stays copy-pasteable.
async function chatNodeWithHeaders(
  state: AgentState,
  config: RunnableConfig,
) {
  return runChatNode(
    state,
    config,
    makeChatOpenAI(config, { temperature: 0, model: "gpt-4o-mini" }),
  );
}

export const showcaseGraph = compileGraph(chatNodeWithHeaders);
