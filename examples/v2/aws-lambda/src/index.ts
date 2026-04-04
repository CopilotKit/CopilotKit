/**
 * AWS Lambda handler for CopilotKit Runtime
 * Issue #1151: Add AWS Lambda example for self-hosted CopilotKit Runtime
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { z } from "zod";
import { CopilotRuntime } from "@copilotkitnext/runtime";
import { 
  BuiltInAgent, 
  defineTool,
  ToolDefinition 
} from "@copilotkitnext/agent";

// Define example tools
const searchTool = defineTool({
  name: "search",
  description: "Search for information",
  parameters: z.object({
    query: z.string().describe("The search query"),
  }),
  execute: async ({ query }) => {
    console.log(`Searching for: ${query}`);
    return `Results for "${query}": Found relevant information.`;
  },
}) as unknown as ToolDefinition;

const calculatorTool = defineTool({
  name: "calculator",
  description: "Perform mathematical calculations",
  parameters: z.object({
    expression: z.string().describe("Mathematical expression to evaluate"),
  }),
  execute: async ({ expression }) => {
    try {
      // Simple evaluation - in production, use a proper math parser
      const result = eval(expression);
      return `Result: ${result}`;
    } catch (error) {
      return `Error: Invalid expression`;
    }
  },
}) as unknown as ToolDefinition;

// Initialize CopilotKit Runtime
const runtime = new CopilotRuntime({
  agents: {
    default: new BuiltInAgent({
      model: "openai/gpt-4o-mini",
      tools: [searchTool, calculatorTool],
      maxSteps: 5,
    }),
    // Additional agents can be configured here
    assistant: new BuiltInAgent({
      model: "openai/gpt-4o",
      tools: [searchTool],
      prompt: "You are a helpful assistant with access to search capabilities.",
    }),
  },
});

/**
 * Main Lambda handler for CopilotKit Runtime
 * Supports both REST and single-route transports
 */
export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  // Enable AWS Lambda context for async operations
  context.callbackWaitsForEmptyEventLoop = false;

  console.log("CopilotKit Lambda Request:", {
    path: event.path,
    method: event.httpMethod,
    headers: Object.keys(event.headers || {}),
  });

  try {
    // Handle CORS preflight
    if (event.httpMethod === "OPTIONS") {
      return {
        statusCode: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
        body: "",
      };
    }

    // Parse request body
    const body = event.body ? JSON.parse(event.body) : {};
    const method = body.method || event.path?.split("/").pop() || "run";

    // Route to appropriate handler based on method
    switch (method) {
      case "agent/run":
      case "run":
        return await handleAgentRun(body, event);
      
      case "agent/connect":
      case "connect":
        return await handleAgentConnect(body, event);
      
      case "agent/stop":
      case "stop":
        return await handleAgentStop(body, event);
      
      case "info":
        return await handleInfo();
      
      default:
        return {
          statusCode: 404,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
          body: JSON.stringify({ error: `Unknown method: ${method}` }),
        };
    }
  } catch (error) {
    console.error("Lambda Error:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        error: "Internal Server Error",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};

/**
 * Handle agent run requests
 */
async function handleAgentRun(
  body: any,
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const { agentId, threadId, messages, state, forwardedProps } = body;

  try {
    // Get agent from runtime
    const agent = runtime.getAgent(agentId || "default");
    
    if (!agent) {
      return {
        statusCode: 404,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({ error: `Agent not found: ${agentId}` }),
      };
    }

    // Set thread ID if provided
    if (threadId) {
      agent.threadId = threadId;
    }

    // Restore state if provided (Issue #3256: State restoration)
    if (state) {
      agent.setState(state);
    }

    // Restore messages if provided (Issue #2200: Thread reloading)
    if (messages && messages.length > 0) {
      agent.setMessages(messages);
    }

    // Run the agent
    const result = await runtime.runAgent({
      agent,
      forwardedProps,
    });

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        success: true,
        threadId: agent.threadId,
        runId: result.runId,
        messages: result.newMessages,
        state: agent.state,
      }),
    };
  } catch (error) {
    console.error("Agent Run Error:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        error: "Agent run failed",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
}

/**
 * Handle agent connect requests
 */
async function handleAgentConnect(
  body: any,
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const { agentId, forwardedProps } = body;

  try {
    const agent = runtime.getAgent(agentId || "default");
    
    if (!agent) {
      return {
        statusCode: 404,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({ error: `Agent not found: ${agentId}` }),
      };
    }

    const result = await runtime.connectAgent({ agent });

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        success: true,
        threadId: agent.threadId,
        runId: result.runId,
        messages: result.newMessages,
      }),
    };
  } catch (error) {
    console.error("Agent Connect Error:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        error: "Agent connect failed",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
}

/**
 * Handle agent stop requests
 */
async function handleAgentStop(
  body: any,
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const { agentId, threadId } = body;

  try {
    const agent = runtime.getAgent(agentId || "default");
    
    if (agent) {
      runtime.stopAgent({ agent });
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        success: true,
        message: "Agent stopped",
      }),
    };
  } catch (error) {
    console.error("Agent Stop Error:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        error: "Agent stop failed",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
}

/**
 * Handle runtime info requests
 */
async function handleInfo(): Promise<APIGatewayProxyResult> {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify({
      version: "2.0.0",
      agents: Object.keys(runtime.agents || {}).map((id) => ({
        id,
        name: id,
        type: "builtin",
      })),
      features: {
        threadRestoration: true,  // Issue #3256
        aguiDirectIntegration: true,  // Issue #2186
        messageHistory: true,  // Issue #1881
      },
    }),
  };
}
