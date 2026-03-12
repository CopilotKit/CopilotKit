import { RunnableConfig } from "@langchain/core/runnables";
import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { AIMessage, SystemMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { convertActionsToDynamicStructuredTools } from "@copilotkit/sdk-js/langgraph";
import {
  CustomerSupportStateAnnotation,
  CustomerSupportState,
} from "./types/state";
import {
  customerLookupTool,
  intentClassifierTool,
  escalationDecisionTool,
  replyGeneratorTool,
} from "./tools/index";

// 1. Define all tools in an array
const tools = [
  customerLookupTool,
  intentClassifierTool,
  escalationDecisionTool,
  replyGeneratorTool,
];

// 2. Main chat node - invokes AI model with tools
async function chat_node(state: CustomerSupportState, config: RunnableConfig) {
  console.log("\n=== CHAT NODE ===");

  // Initialize the model
  const model = new ChatOpenAI({
    model: "gpt-4o",
  });

  // Bind ALL tools (customer support tools + frontend actions from CopilotKit)
  const modelWithTools = model.bindTools([
    ...convertActionsToDynamicStructuredTools(state.copilotkit?.actions ?? []),
    ...tools,
  ]);

  // Create system message with customer support context
  const systemMessage = new SystemMessage({
    content: `You are an AI customer support assistant for a telecom company.

${
  state.currentCustomer?.found
    ? `
🔍 CURRENT CUSTOMER:
- ID: ${state.currentCustomer.id}
- Monthly Charges: $${state.currentCustomer.data?.MonthlyCharges || "N/A"}
- Internet: ${state.currentCustomer.data?.InternetService || "N/A"}
- Contract: ${state.currentCustomer.data?.Contract || "N/A"}
`
    : "No customer loaded yet."
}

${
  state.intent
    ? `
INTENT: ${state.intent.category} (${state.intent.urgency} urgency)
`
    : ""
}

WORKFLOW:
1. First, use "classifyIntent" to understand the user's issue
2. Then use "lookupCustomer" if a customer ID is mentioned
3. Use "checkEscalation" to determine if escalation is needed
4. Finally, use "generateReply" to create a personalized response

Be helpful and professional. Use the customers array from state for lookups.`,
  });

  // Invoke the model
  const response = await modelWithTools.invoke(
    [systemMessage, ...state.messages],
    config
  );

  console.log("Model response generated");

  return {
    messages: response,
  };
}

// 3. Tool node - executes the tools
const tool_node = new ToolNode(tools);

// 4. Process tool results and update state
async function process_tool_results(
  state: CustomerSupportState,
  config: RunnableConfig
) {
  const messages = state.messages || [];
  const lastMessage = messages[messages.length - 1];

  if (lastMessage._getType() === "tool") {
    const toolMessage = lastMessage as any;
    const toolName = toolMessage.name;
    const toolContent = toolMessage.content;

    console.log(`Processing result from: ${toolName}`);

    try {
      // Update state based on which tool was called
      if (toolName === "classifyIntent") {
        const intent = JSON.parse(toolContent);
        console.log(`Intent: ${intent.category} (${intent.urgency})`);
        return {
          ...state,
          intent,
        };
      }

      if (toolName === "lookupCustomer") {
        const lookupResult = JSON.parse(toolContent);
        if (lookupResult.found) {
          console.log(`Customer found: ${lookupResult.customerId}`);
          return {
            ...state,
            currentCustomer: {
              id: lookupResult.customerId,
              found: true,
              data: lookupResult.data,
            },
          };
        }
      }

      if (toolName === "generateReply") {
        const reply = JSON.parse(toolContent);
        console.log("Reply generated");
        return {
          ...state,
          reply,
        };
      }

      if (toolName === "checkEscalation") {
        const escalation = JSON.parse(toolContent);
        if (escalation.required) {
          console.log(`Escalation: ${escalation.ticketId}`);
        }
        return {
          ...state,
          escalation,
        };
      }
    } catch (error) {
      console.error(`Error processing ${toolName}:`, error);
    }
  }

  return { ...state };
}

// 5. Routing logic - determines next node
function shouldContinue({ messages, copilotkit }: CustomerSupportState) {
  const lastMessage = messages[messages.length - 1] as AIMessage;

  // If the LLM makes a tool call, route to tool node
  if (lastMessage.tool_calls?.length) {
    const actions = copilotkit?.actions;
    const toolCallName = lastMessage.tool_calls[0].name;

    console.log(`Tool call: ${toolCallName}`);

    // Only route to tool node if it's NOT a frontend action
    if (!actions || actions.every((action) => action.name !== toolCallName)) {
      return "tool_node";
    }
  }

  // Otherwise, end the conversation
  return "__end__";
}

// 6. Build the workflow graph
const workflow = new StateGraph(CustomerSupportStateAnnotation)
  .addNode("chat_node", chat_node)
  .addNode("tool_node", tool_node)
  .addNode("process_results", process_tool_results)
  .addEdge(START, "chat_node")
  .addEdge("tool_node", "process_results")
  .addEdge("process_results", "chat_node")
  .addConditionalEdges("chat_node", shouldContinue as any);

const memory = new MemorySaver();

// 7. Compile and export
export const graph = workflow.compile({
  checkpointer: memory,
});
