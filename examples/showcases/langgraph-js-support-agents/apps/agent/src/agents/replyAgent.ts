import { RunnableConfig } from "@langchain/core/runnables";
import { CustomerSupportState } from "../types/state";
import { replyGeneratorTool } from "../tools";
import { AIMessage } from "@langchain/core/messages";

/**
 * Reply Agent Node
 * Generates personalized response based on intent and customer data
 */
export async function replyAgentNode(
  state: CustomerSupportState,
  config: RunnableConfig
): Promise<Partial<CustomerSupportState>> {
  console.log("Reply Agent: Generating response...");

  const messages = state.messages || [];
  const lastUserMessage = messages
    .filter((m) => m._getType() === "human")
    .pop();

  if (!lastUserMessage) {
    return {};
  }

  const userMessage =
    typeof lastUserMessage.content === "string"
      ? lastUserMessage.content
      : JSON.stringify(lastUserMessage.content);

  const intent = state.intent?.category || "general_inquiry";
  const customerId = state.currentCustomer?.found
    ? state.currentCustomer.id
    : undefined;

  try {
    const replyResult = await replyGeneratorTool.invoke({
      customerId: customerId,
      intent: intent,
      message: userMessage,
    });

    const reply = JSON.parse(replyResult);

    console.log(`Reply generated for intent: ${intent}`);

    // Create AI message with the reply
    const aiMessage = new AIMessage({
      content: reply.message,
    });

    // Return complete state including customers for proper state flow
    return {
      ...state,
      reply: reply,
      messages: [...messages, aiMessage],
    };
  } catch (error) {
    console.error("Reply generation error:", error);

    // Fallback reply
    const fallbackMessage = new AIMessage({
      content:
        "I'm here to help! Could you please provide more details about your issue?",
    });

    // Return complete state including customers
    return {
      ...state,
      reply: {
        message: fallbackMessage.content as string,
        suggestedActions: ["Provide customer ID", "Describe issue"],
      },
      messages: [...messages, fallbackMessage],
    };
  }
}
