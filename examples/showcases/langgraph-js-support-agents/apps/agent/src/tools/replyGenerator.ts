import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { findCustomerById } from "../utils/dataLoader";
import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

/**
 * Generate personalized reply based on customer context
 */
export const replyGeneratorTool = tool(
  async ({ customerId, intent, message }) => {
    // Get customer data if available
    const customer = customerId ? findCustomerById(customerId) : null;

    // Initialize LLM
    const model = new ChatOpenAI({
      model: "gpt-5-nano",
    });

    // Build context-rich system prompt
    let systemPrompt = `You are a professional telecom customer support agent.

CUSTOMER CONTEXT:
${
  customer
    ? `
- Customer ID: ${customer.customerID}
- Service: ${customer.InternetService}
- Monthly Charges: $${customer.MonthlyCharges}
- Contract: ${customer.Contract}
- Tenure: ${customer.tenure} months
- Streaming TV: ${customer.StreamingTV}
- Streaming Movies: ${customer.StreamingMovies}
- Device Protection: ${customer.DeviceProtection}
- Tech Support: ${customer.TechSupport}
- Payment Method: ${customer.PaymentMethod}
- Churn Risk: ${
        customer.Churn === "Yes" ? "⚠️ HIGH - Prioritize retention!" : "✅ Low"
      }
`
    : "Customer not identified yet - ask for Customer ID"
}

DETECTED INTENT: ${intent}
USER MESSAGE: "${message}"

YOUR TASK:
1. Respond naturally and conversationally (not templated)
2. Reference specific customer data when relevant
3. If churn risk is HIGH, offer retention incentives
4. Provide 2-4 helpful action suggestions
5. Be empathetic and solution-focused
6. Don't just repeat what they said - provide VALUE

RESPONSE FORMAT:
Generate a JSON object with this structure:
{
  "message": "your helpful response here",
  "suggestedActions": ["Action 1", "Action 2", "Action 3"]
}

AVAILABLE FRONTEND ACTIONS:
- calculateServiceCost: Calculate price impact before making changes
- toggleService: Actually change a service (after user confirms)

WORKFLOW FOR SERVICE CHANGES:
1. User: "I want to add Streaming TV"
2. You: Call calculateServiceCost(serviceName="StreamingTV", action="add")
3. You: "Adding Streaming TV will increase your bill by $9.00 (18%). Your new monthly would be $79.70. Would you like to proceed?"
4. User: "Yes, do it"
5. You: Call toggleService(serviceName="StreamingTV", newValue="Yes")
6. You: "Done! Streaming TV is now active. Your receipt has been updated."

IMPORTANT:
- For billing issues: Break down their charges using the customer data
- For cancellations: Acknowledge tenure, offer solutions, mention retention discounts
- For service issues: Show empathy, offer immediate help
- Always be specific using their actual plan details
- ALWAYS calculate cost BEFORE toggling
- Wait for user confirmation
- Reference the exact dollar amounts and percentages`;

    try {
      // Invoke LLM with context
      const response = await model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(message),
      ]);

      const content =
        typeof response.content === "string"
          ? response.content
          : JSON.stringify(response.content);

      // Try to parse as JSON
      try {
        const parsed = JSON.parse(content);
        return JSON.stringify(parsed);
      } catch {
        // If LLM didn't return JSON, wrap it
        return JSON.stringify({
          message: content,
          suggestedActions: [
            "View account details",
            "Speak to specialist",
            "Explore options",
          ],
        });
      }
    } catch (error) {
      console.error("LLM reply generation failed:", error);

      // Fallback to smart template (better than current static ones)
      const fallbackReply = customer
        ? `I understand your ${intent.replace(
            /_/g,
            " "
          )} concern. I can see you're on our ${
            customer.InternetService
          } service at $${
            customer.MonthlyCharges
          }/month. Let me help you with this.`
        : "I'd be happy to help! Could you provide your Customer ID so I can give you personalized assistance?";

      return JSON.stringify({
        message: fallbackReply,
        suggestedActions: ["View account", "Contact specialist"],
      });
    }
  },
  {
    name: "generateReply",
    description:
      "Generate a personalized response based on customer information and their intent.",
    schema: z.object({
      customerId: z
        .string()
        .optional()
        .describe("The customer ID if available"),
      intent: z.string().describe("The classified intent category"),
      message: z.string().describe("The original customer message"),
    }),
  }
);
