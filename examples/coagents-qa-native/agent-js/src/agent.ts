/**
 * Test Q&A Agent
 */

import { RunnableConfig } from "@langchain/core/runnables";
import {
  copilotkitExit,
  convertActionsToDynamicStructuredTools,
} from "@copilotkit/sdk-js/langgraph";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { getModel } from "./model";
import { END, MemorySaver, StateGraph, interrupt } from "@langchain/langgraph";
import { AgentState, AgentStateAnnotation } from "./state";
import { copilotKitInterrupt } from "@copilotkit/sdk-js/langgraph";

export async function email_node(state: AgentState, config: RunnableConfig) {
  /**
   * Write an email.
   */

  const authToken = config.configurable?.authToken ?? null;
  if (authToken !== 'exampleToken') {
    throw new Error('[AUTH ERROR]: This demo uses a dummy auth token. Make sure it is set to "exampleToken" in Mailer.tsx useCoAgent call in the configurable')
  }

  const sender = state.sender ?? interrupt('Please provide a sender name which will appear in the email');
  let senderCompany = state.senderCompany
  let interruptMessages = []
  if (!senderCompany?.length) {
    const { answer, messages } = copilotKitInterrupt({ message: 'Ah, forgot to ask, which company are you working for?' });
    senderCompany = answer;
    interruptMessages = messages;
  }
  const instructions = `You write emails. The email is by the following sender: ${sender}, working for: ${senderCompany}`;

  const email_model = getModel(state).bindTools!(
    convertActionsToDynamicStructuredTools(state.copilotkit.actions),
    {
      tool_choice: "EmailTool",
    }
  );

  const response = await email_model.invoke(
    [...state.messages, ...interruptMessages, new HumanMessage({ content: instructions })],
    config
  );

  const tool_calls = response.tool_calls;

  const email = tool_calls?.[0]?.args.the_email;

  return {
    messages: response,
    email: email,
    sender,
    senderCompany,
  };
}

export async function send_email_node(
  state: AgentState,
  config: RunnableConfig
) {
  /**
   * Send an email.
   */

  await copilotkitExit(config);

  const lastMessage = state.messages[state.messages.length - 1] as ToolMessage;
  const content =
    lastMessage.content === "CANCEL"
      ? "❌ Cancelled sending email."
      : "✅ Sent email.";

  return {
    messages: new AIMessage({ content }),
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
