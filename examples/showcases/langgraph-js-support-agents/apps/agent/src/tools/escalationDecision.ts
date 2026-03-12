import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { findCustomerById } from "../utils/dataLoader";
import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
/**
 * Decide if customer issue should be escalated to human agent
 */
export const escalationDecisionTool = tool(
  async ({ customerId, intent, urgency }) => {
    // Get customer data
    const customer = customerId ? findCustomerById(customerId) : null;

    // Initialize AI model
    const model = new ChatOpenAI({
      model: "gpt-5-nano",
    });

    // Build context for AI
    const customerContext = customer
      ? `
CUSTOMER PROFILE:
- ID: ${customer.customerID}
- Tenure: ${customer.tenure} months
- Monthly Charges: $${customer.MonthlyCharges}
- Contract: ${customer.Contract}
- Service: ${customer.InternetService}
- Churn Risk: ${
          customer.Churn === "Yes" ? "HIGH (at risk of leaving)" : "Low"
        }
- Senior Citizen: ${customer.SeniorCitizen === "1" ? "Yes" : "No"}
- Payment Method: ${customer.PaymentMethod}
`
      : "No customer data available";

    const systemPrompt = `You are an escalation decision expert for telecom support.

${customerContext}

CURRENT ISSUE:
- Intent: ${intent}
- Urgency: ${urgency}

ESCALATION RULES:
1. ALWAYS ESCALATE if:
   - Churn Risk = HIGH (customer might cancel)
   - Intent = cancellation (need retention specialist)
   - Urgency = high (critical issues)
   - Senior Citizen = Yes (need extra care)
   - High-value customer (tenure > 50 months OR charges > $80)

1.5. SUGGEST AI FIRST if:
   - Urgency = high BUT Churn Risk = Low
   - Intent = service_outage, tech_support, internet_issue
   - Return "suggestAiFirst": true to offer AI suggestions before escalating
   - If user declines AI help, then escalate with urgency priority

2. DEPARTMENT ASSIGNMENT:
   - billing/payment issues → "billing" team
   - cancellation → "retention" team (PRIORITY 1)
   - service outage/tech support → "tech" team

3. PRIORITY LEVELS:
   - Priority 1 (Highest): Churn risk + any complaint, cancellations, service outages
   - Priority 2 (Medium): Senior citizens, high-value customers, billing disputes
   - Priority 3 (Low): General inquiries, simple tech support

TASK:
Analyze if this case needs human escalation. Return JSON:
{
  "required": true/false,
  "reason": "detailed reason why escalating or not",
  "assignedTo": "billing" | "tech" | "retention",
  "priority": 1 | 2 | 3,
  "suggestAiFirst": true/false
}

EXAMPLES:
Customer: Churn=Yes, Intent=billing_issue
Response: {"required": true, "reason": "Customer at risk of churn with billing complaint - retention priority", "assignedTo": "retention", "priority": 1}

Customer: Churn=No, Intent=general_inquiry, Urgency=low
Response: {"required": false, "reason": "Simple inquiry, AI can handle", "assignedTo": "tech", "priority": 3}

Customer: Churn=No, Intent=internet_issue, Urgency=high
Response: {"required": false, "reason": "High urgency tech issue but customer stable - offer AI suggestions first", "assignedTo": "tech", "priority": 2, "suggestAiFirst": true}

Now decide:`;

    try {
      // Invoke AI for escalation decision
      const response = await model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(`Should this case be escalated?`),
      ]);

      const content =
        typeof response.content === "string"
          ? response.content
          : JSON.stringify(response.content);

      // Parse AI decision
      try {
        const parsed = JSON.parse(content);

        // Generate ticket ID if escalating
        if (parsed.required) {
          parsed.ticketId = `TKT-${Date.now()}-${Math.random()
            .toString(36)
            .substr(2, 5)
            .toUpperCase()}`;
        }

        return JSON.stringify(parsed);
      } catch (parseError) {
        console.error("AI escalation decision parse error:", parseError);
        // Fallback to rule-based logic
        return fallbackRuleBasedEscalation(customerId, intent, urgency);
      }
    } catch (error) {
      console.error("AI escalation decision failed:", error);
      // Fallback to rule-based logic
      return fallbackRuleBasedEscalation(customerId, intent, urgency);
    }
  },
  {
    name: "checkEscalation",
    description:
      "Determine if the customer issue should be escalated to a human agent based on urgency, customer profile, and issue type.",
    schema: z.object({
      customerId: z
        .string()
        .optional()
        .describe("The customer ID if available"),
      intent: z.string().describe("The classified intent category"),
      urgency: z.enum(["low", "medium", "high"]).describe("The urgency level"),
    }),
  }
);

// Fallback rule-based escalation if AI fails
function fallbackRuleBasedEscalation(
  customerId: string | undefined,
  intent: string,
  urgency: string
) {
  let shouldEscalate = false;
  let reason = "";
  let assignedTo: "billing" | "tech" | "retention" = "tech";
  let priority: 1 | 2 | 3 = 3;
  let suggestAiFirst = false;

  if (urgency === "high") {
    shouldEscalate = true;
    reason = "High urgency issue detected";
    priority = 1;
  }

  if (customerId) {
    const customer = findCustomerById(customerId);

    if (customer) {
      if (customer.Churn === "Yes") {
        shouldEscalate = true;
        reason = reason
          ? `${reason}; Customer at risk of churn`
          : "Customer at risk of churn - retention priority";
        assignedTo = "retention";
        priority = 1;
      }

      if (customer.SeniorCitizen === "1") {
        shouldEscalate = true;
        reason = reason
          ? `${reason}; Senior citizen`
          : "Senior citizen requiring special assistance";
        if (priority > 2) priority = 2;
      }

      if (
        parseInt(customer.tenure) > 50 ||
        parseFloat(customer.MonthlyCharges) > 80
      ) {
        shouldEscalate = true;
        reason = reason
          ? `${reason}; High-value customer`
          : "High-value customer - priority handling";
        if (priority > 2) priority = 2;
      }

      if (
        urgency === "high" && 
        customer.Churn === "No" && 
        (intent === "service_outage" || intent === "tech_support" || intent === "internet_issue")
      ) {
        suggestAiFirst = true;
        shouldEscalate = false; // Don't escalate immediately
        reason = "High urgency tech issue - offering AI suggestions first before escalation";
        priority = 2;
      }
    }
  }

  if (intent === "billing_issue" || intent === "payment_issue") {
    assignedTo = "billing";
  } else if (intent === "cancellation") {
    assignedTo = "retention";
    shouldEscalate = true;
    reason = reason
      ? `${reason}; Cancellation request`
      : "Cancellation request - requires retention team";
    priority = 1;
  } else if (intent === "service_outage" || intent === "tech_support") {
    assignedTo = "tech";
  }

  const ticketId = shouldEscalate
    ? `TKT-${Date.now()}-${Math.random()
        .toString(36)
        .substr(2, 5)
        .toUpperCase()}`
    : undefined;

  return JSON.stringify({
    required: shouldEscalate,
    reason: reason || "No escalation needed - can be handled by AI assistant",
    ticketId: ticketId,
    assignedTo: assignedTo,
    priority: priority,
    suggestAiFirst: suggestAiFirst,
  });
}
