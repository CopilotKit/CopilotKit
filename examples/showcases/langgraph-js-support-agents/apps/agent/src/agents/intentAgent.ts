import { RunnableConfig } from "@langchain/core/runnables";
import { CustomerSupportState, IntentResult } from "../types/state";
import { intentClassifierTool } from "../tools";
import { AIMessage } from "@langchain/core/messages";

/**
 * Intent Agent Node
 * Classifies customer's message to determine intent and urgency
 */
export async function intentAgentNode(
  state: CustomerSupportState,
  config: RunnableConfig
): Promise<Partial<CustomerSupportState>> {
  // Get the last user message
  const messages = state.messages || [];
  const lastMessage = messages[messages.length - 1];

  if (!lastMessage || lastMessage._getType() === "ai") {
    // No user message to classify
    return {};
  }

  const userMessage =
    typeof lastMessage.content === "string"
      ? lastMessage.content
      : JSON.stringify(lastMessage.content);

  console.log("Intent Agent: Classifying message...");

  try {
    // Use the intent classifier tool
    const intentResult = await intentClassifierTool.invoke({
      message: userMessage,
    });

    const intent: IntentResult = JSON.parse(intentResult);

    console.log(
      `Intent classified: ${intent.category} (urgency: ${intent.urgency})`
    );

    // Add AI message about classification
    const aiMessage = new AIMessage({
      content: `I understand this is a ${intent.category.replace(
        "_",
        " "
      )} issue with ${intent.urgency} urgency. Let me help you with that.`,
    });

    return {
      ...state,
      intent: intent,
      messages: [...messages, aiMessage],
    };
  } catch (error) {
    console.error("Intent classification error:", error);

    // Default to general inquiry if classification fails
    return {
      ...state,
      intent: {
        category: "general_inquiry",
        urgency: "low",
        confidence: 0.5,
        keywords: [],
      },
    };
  }
}
