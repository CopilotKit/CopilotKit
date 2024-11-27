/**
 * Test Q&A Agent
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { RunnableConfig } from "@langchain/core/runnables";
import {
  copilotKitCustomizeConfig,
  copilotKitEmitMessage,
  copilotKitExit,
} from "@copilotkit/sdk-js/langchain";
import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import { getModel } from "./model";
import { END, MemorySaver, StateGraph } from "@langchain/langgraph";
import { AgentState, AgentStateAnnotation } from "./state";

const EmailTool = tool(() => {}, {
  name: "EmailTool",
  description: "Write an email.",
  schema: z.object({
    the_email: z.string().describe("The email to be written."),
  }),
});

export async function email_node(state: AgentState, config: RunnableConfig) {
  /**
   * Write an email.
   */

  const modifiedConfig = copilotKitCustomizeConfig(config, {
    emitToolCalls: true,
  });

  const instructions = "You write emails.";

  const email_model = getModel(state).bindTools!([EmailTool], {
    tool_choice: "EmailTool",
  });

  const response = await email_model.invoke(
    [...state.messages, new HumanMessage({ content: instructions })],
    modifiedConfig
  );

  const tool_calls = response.tool_calls;

  const email = tool_calls?.[0]?.args.the_email;

  return {
    email: email,
  };
}

export async function send_email_node(
  state: AgentState,
  config: RunnableConfig
) {
  /**
   * Send an email.
   */

  await copilotKitExit(config);

  const lastMessage = state.messages[state.messages.length - 1] as ToolMessage;
  if (lastMessage.content === "CANCEL") {
    await copilotKitEmitMessage(config, "❌ Cancelled sending email.");
  } else {
    await copilotKitEmitMessage(config, "✅ Sent email.");
  }

  return {
    messages: state.messages,
  };
}

const workflow = new StateGraph(AgentStateAnnotation)
  .addNode("email_node", email_node)
  .addNode("send_email_node", send_email_node)
  .setEntryPoint("email_node")
  .addEdge("email_node", "send_email_node")
  .addEdge("send_email_node", END);

const memory = new MemorySaver();

export const graph = workflow.compile({
  checkpointer: memory,
  interruptAfter: ["email_node"],
});
