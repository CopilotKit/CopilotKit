import { RunnableConfig } from "@langchain/core/runnables";
import { CustomerSupportState } from "../types/state";
import { escalationDecisionTool } from "../tools";
import { AIMessage } from "@langchain/core/messages";/**
 * Escalation Agent Node
 * Determines if issue needs human intervention
 */
export async function escalationAgentNode(
  state: CustomerSupportState,
  config: RunnableConfig
): Promise<Partial<CustomerSupportState>> {
  console.log("Escalation Agent: Checking escalation criteria...");

  const intent = state.intent?.category || "general_inquiry";
  const urgency = state.intent?.urgency || "low";
  const customerId = state.currentCustomer?.found
    ? state.currentCustomer.id
    : undefined;

  try {
    const escalationResult = await escalationDecisionTool.invoke({
      customerId: customerId,
      intent: intent,
      urgency: urgency,
    });

    const escalation = JSON.parse(escalationResult);

    if (escalation.required) {
      console.log(`ESCALATION REQUIRED: ${escalation.reason}`);
      console.log(`Ticket: ${escalation.ticketId}`);
      console.log(
        `Assigned to: ${escalation.assignedTo} (Priority: ${escalation.priority})`
      );

      const messages = state.messages || [];
      const escalationMessage = new AIMessage({
        content: `I've created a priority ticket (${escalation.ticketId}) for you. Our ${escalation.assignedTo} team will contact you shortly. ${escalation.reason}`,
      });

      // Return complete state including customers
      return {
        ...state,
        escalation: escalation,
        messages: [...messages, escalationMessage],
      };
    }
     else {
      console.log("No escalation needed - AI can handle this");
      // Return complete state including customers
      return {
        ...state,
        escalation: escalation,
      };
    }
  } catch (error) {
    console.error("Escalation check error:", error);

    // Default to no escalation on error
    // Return complete state including customers
    return {
      ...state,
      escalation: {
        required: false,
        reason: "Unable to determine escalation - defaulting to AI handling",
        priority: 3,
      },
    };
  }
}
