/**
 * CopilotKit API Route with A2A Middleware
 *
 * Sets up the connection between:
 * - Frontend (CopilotKit) → A2A Middleware → Orchestrator → A2A Agents
 *
 * KEY CONCEPTS:
 * - AG-UI Protocol: Agent-UI communication (CopilotKit ↔ Orchestrator)
 * - A2A Protocol: Agent-to-agent communication (Orchestrator ↔ Specialized Agents)
 * - A2A Middleware: Injects send_message_to_a2a_agent tool to bridge AG-UI and A2A
 */

import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";
import { A2AMiddlewareAgent } from "@ag-ui/a2a-middleware";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  // STEP 1: Define A2A agent URLs
  const itineraryAgentUrl = process.env.ITINERARY_AGENT_URL || "http://localhost:9001";
  const budgetAgentUrl = process.env.BUDGET_AGENT_URL || "http://localhost:9002";
  const restaurantAgentUrl = process.env.RESTAURANT_AGENT_URL || "http://localhost:9003";
  const weatherAgentUrl = process.env.WEATHER_AGENT_URL || "http://localhost:9005";

  // STEP 2: Define orchestrator URL (speaks AG-UI Protocol)
  const orchestratorUrl = process.env.ORCHESTRATOR_URL || "http://localhost:9000";

  // STEP 3: Wrap orchestrator with HttpAgent (AG-UI client)
  const orchestrationAgent = new HttpAgent({
    url: orchestratorUrl,
  });

  // STEP 4: Create A2A Middleware Agent
  // This bridges AG-UI and A2A protocols by:
  // 1. Wrapping the orchestrator
  // 2. Registering all A2A agents
  // 3. Injecting send_message_to_a2a_agent tool
  // 4. Routing messages between orchestrator and A2A agents
  const a2aMiddlewareAgent = new A2AMiddlewareAgent({
    description:
      "Travel planning assistant with 4 specialized agents: Itinerary and Restaurant (LangGraph), Weather and Budget (ADK)",

    agentUrls: [
      itineraryAgentUrl, // LangGraph + OpenAI
      restaurantAgentUrl, // ADK + Gemini
      budgetAgentUrl, // ADK + Gemini
      weatherAgentUrl, // ADK + Gemini
    ],

    orchestrationAgent,

    // Workflow instructions (middleware auto-adds routing info)
    instructions: `
      You are a travel planning assistant that orchestrates between 4 specialized agents.

      AVAILABLE AGENTS:

      - Itinerary Agent (LangGraph): Creates day-by-day travel itineraries with activities
      - Restaurant Agent (LangGraph): Recommends breakfast, lunch, dinner for each day
      - Weather Agent (ADK): Provides weather forecasts and packing advice
      - Budget Agent (ADK): Estimates travel costs and creates budget breakdowns

      WORKFLOW STRATEGY (SEQUENTIAL - ONE AT A TIME):

      0. **FIRST STEP - Gather Trip Requirements**:
         - Before doing ANYTHING else, call 'gather_trip_requirements' to collect essential trip information
         - Try to extract any mentioned details from the user's message (city, days, people, budget level)
         - Pass any extracted values as parameters to pre-fill the form:
           * city: Extract destination city if mentioned (e.g., "Paris", "Tokyo")
           * numberOfDays: Extract if mentioned (e.g., "5 days", "a week")
           * numberOfPeople: Extract if mentioned (e.g., "2 people", "family of 4")
           * budgetLevel: Extract if mentioned (e.g., "budget", "luxury") -> map to Economy/Comfort/Premium
         - Wait for the user to submit the complete requirements
         - Use the returned values for all subsequent agent calls

      1. Itinerary Agent - Create the base itinerary using the trip requirements
         - Pass: city, numberOfDays from trip requirements
         - The itinerary will have empty meals initially

      2. Weather Agent - Get forecast to inform planning
         - Pass: city and numberOfDays from trip requirements

      3. Restaurant Agent - Get day-by-day meal recommendations
         - Pass: city and numberOfDays from trip requirements
         - The meals will populate the itinerary display

      4. Budget Agent - Create cost estimate
         - Pass: city, numberOfDays, numberOfPeople, budgetLevel from trip requirements
         - This creates an accurate budget based on all the information

      5. **IMPORTANT**: Use 'request_budget_approval' tool for budget approval
         - Pass the budget JSON data to this tool
         - Wait for the user's decision before proceeding

      6. Present complete plan to user

      CRITICAL RULES:
      - **ALWAYS START by calling 'gather_trip_requirements' FIRST before any agent calls**
      - Call tools/agents ONE AT A TIME - never make multiple tool calls simultaneously
      - After making a tool call, WAIT for the result before making the next call
      - Pass information from trip requirements and earlier agents to later agents
      - You MUST call 'request_budget_approval' after receiving the budget
      - After receiving approval, present a complete summary to the user

      TRIP REQUIREMENTS EXTRACTION EXAMPLES:
      - "Plan a trip to Paris" -> city: "Paris"
      - "5 day trip to Tokyo for 2 people" -> city: "Tokyo", numberOfDays: 5, numberOfPeople: 2
      - "Budget vacation to Bali" -> city: "Bali", budgetLevel: "Economy"
      - "Luxury 3-day getaway for my family of 4" -> numberOfDays: 3, numberOfPeople: 4, budgetLevel: "Premium"

      Human-in-the-Loop (HITL):
      - Always gather trip requirements using 'gather_trip_requirements' at the start
      - Always request budget approval using 'request_budget_approval' after budget is created
      - Wait for user responses before proceeding

      Additional Rules:
      - Once you have received information from an agent, do not call that agent again
      - Each agent returns structured JSON - acknowledge and build on the information
      - Always provide a final response that synthesizes ALL gathered information
    `,
  });

  // STEP 5: Create CopilotKit Runtime
  const runtime = new CopilotRuntime({
    agents: {
      a2a_chat: a2aMiddlewareAgent, // Must match frontend: <CopilotKit agent="a2a_chat">
    },
  });

  // STEP 6: Set up Next.js endpoint handler
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter: new ExperimentalEmptyAdapter(),
    endpoint: "/api/copilotkit",
  });

  return handleRequest(request);
}
