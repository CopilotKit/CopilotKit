/**
 * CopilotKit API route with multi-agent setup.
 *
 * This route supports two agents that the frontend can switch between:
 * 1. "default" - BasicAgent + MCPAppsMiddleware for Static GenUI and MCP Apps
 * 2. "a2ui" - HttpAgent connecting to Python A2A server for A2UI rendering
 *
 * The frontend uses the `agent` prop on CopilotKitProvider to select which agent to use.
 */

import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime";
import { handle } from "hono/vercel";
import { BasicAgent } from "@copilotkit/runtime/v2";
import { MCPAppsMiddleware } from "@ag-ui/mcp-apps-middleware";
import { A2AAgent } from "@ag-ui/a2a";
import { A2AClient } from "@a2a-js/sdk/client";

// Use OpenAI gpt-5.2 as specified in project requirements
const MODEL = "openai/gpt-5.2";

/**
 * "default" Agent: BasicAgent with MCPAppsMiddleware
 *
 * Handles:
 * - Static GenUI tools (get_weather, get_stock, approve_task)
 * - MCP Apps (flights, hotels, trading, kanban, calculator, todo)
 */
const defaultAgent = new BasicAgent({
  model: MODEL,
  prompt: `You are an AI assistant that demonstrates different types of Generative UI.

## Static GenUI Tools
You have access to these tools that render React components:

1. **get_weather** - Get weather information for a location
   - Parameters: location (string)
   - Example: "What's the weather in Tokyo?"

2. **get_stock** - Get stock price information
   - Parameters: symbol (string)
   - Example: "What's the stock price for AAPL?"

3. **approve_task** - Create a task that requires human approval
   - Parameters: taskTitle (string), taskDescription (string)
   - Example: "Create a task: Review PR #123"

## MCP Apps (Interactive Apps in Chat)
You also have access to 6 interactive apps that render in the chat:

1. **search-flights** - Airline booking with seat selection
   - Parameters: origin, destination, departureDate, passengers, cabinClass
   - Example: "Book a flight from JFK to LAX on January 20th"

2. **search-hotels** - Hotel search and booking
   - Parameters: city, checkIn, checkOut, guests, rooms
   - Example: "Find hotels in Paris from January 15 to 18"

3. **create-portfolio** - Investment simulator
   - Parameters: initialBalance, riskTolerance, focus
   - Example: "Create a $10,000 tech-focused portfolio"

4. **create-board** - Kanban task board
   - Parameters: projectName, template
   - Example: "Create a kanban board for my project"

5. **open-calculator** - Interactive calculator
   - Example: "Open the calculator"

6. **open-todo-list** - Todo list manager
   - Example: "Show my todo list"

## Guidelines
- When users ask about weather or stocks, use the corresponding tool
- When users need task approval, use the approve_task tool
- When users want interactive apps (flights, hotels, etc.), use the MCP tools
- Be helpful and guide users through the features`,
  temperature: 0.7,
}).use(
  new MCPAppsMiddleware({
    mcpServers: [
      {
        type: "http",
        url: process.env.MCP_SERVER_URL || "http://localhost:3001/mcp",
      },
    ],
  }),
);

/**
 * "a2ui" Agent: A2AAgent connecting to Python A2A server
 *
 * The A2A server generates A2UI declarative JSON that the frontend renders
 * using the A2UIRenderer component. A2AAgent (unlike HttpAgent) properly
 * negotiates the A2UI extension with the server.
 *
 * Handles:
 * - Restaurant finding and booking with rich UI
 */
const a2aClient = new A2AClient(
  process.env.A2A_AGENT_URL || "http://localhost:10002",
);
const a2uiAgent = new A2AAgent({ a2aClient });

// Create CopilotKit runtime with both agents
const runtime = new CopilotRuntime({
  agents: {
    default: defaultAgent, // Static GenUI + MCP Apps
    a2ui: a2uiAgent, // A2UI with Python A2A server
  },
  runner: new InMemoryAgentRunner(),
});

// Create Hono endpoint
const app = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handle(app);
export const POST = handle(app);
