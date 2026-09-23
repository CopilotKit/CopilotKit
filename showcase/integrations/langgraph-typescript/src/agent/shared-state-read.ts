/**
 * LangGraph TypeScript agent backing the Shared State (Read-only) demo.
 *
 * The recipe editor owns `recipe` and publishes every edit with
 * `agent.setState`. This agent reads that value on every model call and has
 * no tool that writes it, so the UI stays the only writer.
 *
 * Ported from `src/agents/shared_state_read.py` in the langgraph-python
 * sibling package.
 */

import { makeChatOpenAI } from "./openai-headers";

// @region[shared-state-read-agent]
import type { RunnableConfig } from "@langchain/core/runnables";
import { SystemMessage } from "@langchain/core/messages";
import {
  Annotation,
  MemorySaver,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { CopilotKitStateAnnotation } from "@copilotkit/sdk-js/langgraph";

const AgentStateAnnotation = Annotation.Root({
  ...CopilotKitStateAnnotation.spec,
  // Written only by the UI. Declaring the key is what lets a run carry it:
  // the LangGraph adapter sends only the keys in the graph's input schema.
  recipe: Annotation<Record<string, unknown>>,
});

export type AgentState = typeof AgentStateAnnotation.State;

const SYSTEM_PROMPT =
  "You are a helpful, concise recipe assistant. The user edits the recipe " +
  "in the app, and its current value is included below as agent state. " +
  "Base every answer on that recipe. You cannot change it; suggest edits " +
  "for the user to make instead.";

// Built from state on every model call, so the model always sees the
// user's latest edit.
function buildRecipeMessage(
  recipe: Record<string, unknown> | undefined,
): SystemMessage | null {
  if (!recipe) return null;
  return new SystemMessage({
    content: `Current recipe (agent state):\n${JSON.stringify(recipe, null, 2)}`,
  });
}

async function runChatNode(
  state: AgentState,
  config: RunnableConfig,
  model: ChatOpenAI,
) {
  const recipeMessage = buildRecipeMessage(state.recipe);
  const systemMessages = [
    new SystemMessage({ content: SYSTEM_PROMPT }),
    ...(recipeMessage ? [recipeMessage] : []),
  ];

  const response = await model.invoke(
    [...systemMessages, ...state.messages],
    config,
  );

  return { messages: response };
}

async function chatNode(state: AgentState, config: RunnableConfig) {
  return runChatNode(state, config, new ChatOpenAI({ model: "gpt-4o-mini" }));
}

function compileGraph(node: typeof chatNode) {
  return new StateGraph(AgentStateAnnotation)
    .addNode("chat_node", node)
    .addEdge(START, "chat_node")
    .addEdge("chat_node", "__end__")
    .compile({ checkpointer: new MemorySaver() });
}

export const graph = compileGraph(chatNode);
// @endregion[shared-state-read-agent]

// The LangGraph CLI targets this export so showcase probes retain inbound
// x-* header forwarding; the public `graph` above stays copy-pasteable.
//
// Both graphs use a non-reasoning model on purpose. @langchain/openai sends
// system messages to gpt-5 models as `developer` messages over Chat
// Completions, and the D6 fixture proves the recipe reached the model with
// an AIMock `systemMessage` match, which reads only `system` messages.
async function chatNodeWithHeaders(state: AgentState, config: RunnableConfig) {
  return runChatNode(
    state,
    config,
    makeChatOpenAI(config, { model: "gpt-4o-mini" }),
  );
}

export const showcaseGraph = compileGraph(chatNodeWithHeaders);
