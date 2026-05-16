/**
 * LangGraph TypeScript agent backing the Shared State (Agent Read-Only) demo.
 *
 * Demonstrates the `useAgentContext` hook from @copilotkit/react-core/v2:
 * the frontend provides READ-ONLY context *to* the agent. This is the
 * reverse direction of writable-shared-state — the UI cannot be edited by
 * the agent, but the agent reads this context on every turn via
 * CopilotKit's state forwarding, which routes the context entries into the
 * model's message history.
 *
 * No custom state, no tools: this is the minimal shape of the
 * useAgentContext pattern. The agent just reads whatever context the
 * frontend registered and answers accordingly.
 */

import { RunnableConfig } from "@langchain/core/runnables";
import { SystemMessage } from "@langchain/core/messages";
import { MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { CopilotKitStateAnnotation } from "@copilotkit/sdk-js/langgraph";

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
  const model = new ChatOpenAI({ model: "gpt-5.4" });

  // Inject read-only context from useAgentContext / useCopilotReadable.
  // Mirrors the `createAppContextBeforeAgent` logic in CopilotKitMiddleware:
  // context may be a string or an object — stringify it and prepend as a
  // system message right after the main system prompt.
  const appContext = state.copilotkit?.context;
  const isEmptyContext =
    !appContext ||
    (typeof appContext === "string" && appContext.trim() === "") ||
    (typeof appContext === "object" && Object.keys(appContext).length === 0);

  const systemMessages: SystemMessage[] = [
    new SystemMessage({ content: SYSTEM_PROMPT }),
  ];

  if (!isEmptyContext) {
    const contextContent =
      typeof appContext === "string"
        ? appContext
        : JSON.stringify(appContext, null, 2);
    systemMessages.push(
      new SystemMessage({ content: `App Context:\n${contextContent}` }),
    );
  }

  const response = await model.invoke(
    [...systemMessages, ...state.messages],
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
