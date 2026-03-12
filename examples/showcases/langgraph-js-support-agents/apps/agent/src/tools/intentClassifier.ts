import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

/**
 * Classify customer intent based on their message
 */
export const intentClassifierTool = tool(
  async ({ message }) => {
    // Initialize AI model
    const model = new ChatOpenAI({
      model: "gpt-5-nano",
    });

    // System prompt for intent classification
    const systemPrompt = `You are an expert intent classifier for telecom customer support.

INTENT CATEGORIES:
1. billing_issue - Questions about charges, payments, invoices, pricing, discounts
2. service_outage - Internet/phone not working, slow, disconnected, down
3. cancellation - Customer wants to cancel, terminate, or stop service
4. tech_support - Setup help, configuration, installation, technical problems
5. upgrade_request - Want faster internet, better plan, fiber upgrade
6. payment_issue - Payment failed, can't pay, autopay problems
7. general_inquiry - General questions, greetings, information requests

URGENCY LEVELS:
- HIGH: Service outages, cancellations, payment failures, urgent keywords
- MEDIUM: Billing issues, tech support, complex problems
- LOW: General inquiries, simple questions

TASK:
Analyze the user message and return a JSON object with:
{
  "category": "one of the 7 categories above",
  "urgency": "low | medium | high",
  "confidence": 0.0-1.0 (how confident you are),
  "keywords": ["key", "words", "that", "matched"]
}

EXAMPLES:
Message: "My internet has been down for 3 hours!"
Response: {"category": "service_outage", "urgency": "high", "confidence": 0.95, "keywords": ["internet", "down", "hours"]}

Message: "What discounts can you offer?"
Response: {"category": "billing_issue", "urgency": "medium", "confidence": 0.85, "keywords": ["discounts", "offer"]}

Message: "I want to cancel my subscription"
Response: {"category": "cancellation", "urgency": "high", "confidence": 0.98, "keywords": ["cancel", "subscription"]}

Now classify this message:`;

    try {
      // Invoke AI for classification
      const response = await model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(message),
      ]);

      const content =
        typeof response.content === "string"
          ? response.content
          : JSON.stringify(response.content);

      // Try to parse AI response as JSON
      try {
        const parsed = JSON.parse(content);

        // Validate the response has required fields
        if (!parsed.category || !parsed.urgency) {
          throw new Error("Invalid AI response format");
        }

        return JSON.stringify(parsed);
      } catch (parseError) {
        console.error("AI classification parse error:", parseError);
        // Fallback to keyword matching (keep existing logic as backup)
        return fallbackKeywordClassification(message);
      }
    } catch (error) {
      console.error("AI intent classification failed:", error);
      // Fallback to keyword matching
      return fallbackKeywordClassification(message);
    }
  },
  {
    name: "classifyIntent",
    description:
      "Classify the customer's intent and urgency level based on their message. Returns intent category, urgency level, and confidence score.",
    schema: z.object({
      message: z.string().describe("The customer's message to classify"),
    }),
  }
);

// Fallback keyword-based classification if AI fails
function fallbackKeywordClassification(message: string) {
  const lowerMessage = message.toLowerCase();

  const intentPatterns = {
    billing_issue: [
      "bill",
      "charge",
      "payment",
      "invoice",
      "expensive",
      "cost",
      "price",
      "refund",
      "discount",
    ],
    service_outage: [
      "not working",
      "down",
      "outage",
      "slow",
      "disconnected",
      "no internet",
      "connection",
    ],
    cancellation: [
      "cancel",
      "terminate",
      "stop service",
      "end subscription",
      "quit",
    ],
    tech_support: [
      "help",
      "support",
      "issue",
      "problem",
      "error",
      "configure",
      "setup",
      "install",
    ],
    upgrade_request: [
      "upgrade",
      "faster",
      "better plan",
      "fiber",
      "premium",
      "more speed",
    ],
    payment_issue: [
      "payment failed",
      "can't pay",
      "declined",
      "payment error",
      "autopay",
    ],
    general_inquiry: [
      "hello",
      "hi",
      "info",
      "question",
      "how",
      "what",
      "when",
      "where",
    ],
  };

  let bestIntent = "general_inquiry";
  let maxMatches = 0;
  let matchedKeywords: string[] = [];

  for (const [intent, keywords] of Object.entries(intentPatterns)) {
    const matches = keywords.filter((keyword) =>
      lowerMessage.includes(keyword)
    );
    if (matches.length > maxMatches) {
      maxMatches = matches.length;
      bestIntent = intent;
      matchedKeywords = matches;
    }
  }

  let urgency: "low" | "medium" | "high" = "low";

  if (
    bestIntent === "service_outage" ||
    bestIntent === "cancellation" ||
    bestIntent === "payment_issue"
  ) {
    urgency = "high";
  } else if (bestIntent === "billing_issue" || bestIntent === "tech_support") {
    urgency = "medium";
  }

  const urgentKeywords = [
    "urgent",
    "emergency",
    "immediately",
    "asap",
    "critical",
    "now",
  ];
  if (urgentKeywords.some((kw) => lowerMessage.includes(kw))) {
    urgency = "high";
  }

  const confidence =
    maxMatches > 0 ? Math.min(0.5 + maxMatches * 0.15, 0.95) : 0.6;

  return JSON.stringify({
    category: bestIntent,
    urgency: urgency,
    confidence: confidence,
    keywords: matchedKeywords,
  });
}
