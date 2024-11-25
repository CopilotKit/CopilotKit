/**
 * Test Q&A Agent
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { AgentState, AgentStateAnnotation } from "./state";
import { RunnableConfig } from "@langchain/core/runnables";
import {
  copilotKitEmitMessage,
  copilotKitExit,
} from "@copilotkit/sdk-js/langchain";
import { HumanMessage } from "@langchain/core/messages";
import { getModel } from "./model";
import { END, MemorySaver, StateGraph } from "@langchain/langgraph";

const ExtractNameTool = tool(() => {}, {
  name: "ExtractNameTool",
  description:
    "Extract the user's name from the message.\n" +
    "Make sure to only set the name if you are 100 percent sure it is the name of the user.",
  schema: z.object({
    name: z
      .string()
      .describe("The user's name or UNKNOWN if you can't find it"),
  }),
});

export async function ask_name_node(state: AgentState, config: RunnableConfig) {
  /**
   * Ask the user for their name.
   */

  await copilotKitEmitMessage(config, "Hey, what is your name? 🙂");

  return {
    messages: state.messages,
  };
}

export async function extract_name_node(
  state: AgentState,
  config: RunnableConfig
) {
  const lastMessage = state.messages[state.messages.length - 1] as HumanMessage;
  const instructions = `Figure out the user's name if possible from this response they gave you: ${lastMessage.content}`;
  const model = getModel(state).bindTools!([ExtractNameTool], {
    tool_choice: "ExtractNameTool",
  });

  const response = await model.invoke(
    [...state.messages, new HumanMessage({ content: instructions })],
    config
  );

  const toolCalls = response.tool_calls;
  let name: string | undefined = undefined;

  if (toolCalls?.[0]?.args.name && toolCalls[0].args.name !== "UNKNOWN") {
    name = toolCalls[0].args.name;
  }

  if (!name) {
    return {
      messages: state.messages,
    };
  } else {
    return {
      messages: state.messages,
      name,
    };
  }
}

export async function greet_node(state: AgentState, config: RunnableConfig) {
  await copilotKitEmitMessage(config, `Hello, ${state.name} 😎`);

  await copilotKitExit(config);

  return {
    messages: state.messages,
  };
}

function route(state: AgentState) {
  if (state.name) {
    return "greet_node";
  }
  return "ask_name_node";
}

const workflow = new StateGraph(AgentStateAnnotation)
  .addNode("ask_name_node", ask_name_node)
  .addNode("greet_node", greet_node)
  .addNode("extract_name_node", extract_name_node)
  .setEntryPoint("ask_name_node")
  .addEdge("ask_name_node", "extract_name_node")
  .addConditionalEdges("extract_name_node", route, [
    "greet_node",
    "ask_name_node",
  ])
  .addEdge("greet_node", END);

const memory = new MemorySaver();

export const graph = workflow.compile({
  checkpointer: memory,
  interruptAfter: ["ask_name_node"],
});
