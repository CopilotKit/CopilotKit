// ---------------------------------------------------------------------------
// tkt-2732: Sub agents within an agent is not working (Mastra)
//
// Issue: When a Mastra agent (emailAgent) has another agent (weatherAgent)
// configured as a sub-agent via the `agents` property, the email agent
// cannot delegate to the weather agent when going through CopilotKit.
//
// Root cause: @ag-ui/mastra's MastraAgent.streamMastraAgent() always calls
// agent.stream() — never agent.network(). In Mastra, .stream() treats the
// agent as a standalone agent without sub-agent routing. Only .network()
// activates the routing behavior that allows an agent to delegate to its
// sub-agents.
//
// The Mastra playground works because it calls .network() directly.
// CopilotKit goes through AG-UI which wraps the agent and calls .stream().
//
// See: @ag-ui/mastra/dist/index.mjs — streamMastraAgent method
// ---------------------------------------------------------------------------

import { openai } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { MastraAgent } from "@ag-ui/mastra";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNodeHttpEndpoint,
} from "@copilotkit/runtime";

console.log("[tkt-2732 server] Initializing Mastra agents...");

// ---------------------------------------------------------------------------
// 1. Weather tool — simple mock that returns weather data
// ---------------------------------------------------------------------------

const getWeatherTool = createTool({
  id: "get-weather",
  description: "Get current weather information for a given city or location",
  inputSchema: z.object({
    location: z.string().describe("City name or location"),
  }),
  outputSchema: z.object({
    temperature: z.number(),
    conditions: z.string(),
    humidity: z.number(),
    location: z.string(),
  }),
  execute: async (inputData) => {
    console.log("[tkt-2732 server] getWeatherTool called with:", inputData.location);
    // Mock response — avoids needing a real API key for reproduction
    const result = {
      temperature: 18,
      conditions: "Partly cloudy",
      humidity: 65,
      location: inputData.location,
    };
    console.log("[tkt-2732 server] getWeatherTool result:", result);
    return result;
  },
});

// ---------------------------------------------------------------------------
// 2. Weather agent — standalone agent with the weather tool
// ---------------------------------------------------------------------------

const weatherAgent = new Agent({
  id: "weather-agent",
  name: "Weather Agent",
  description:
    "Retrieves current weather information for any city or location. " +
    "Use this agent when you need weather data like temperature, conditions, or humidity.",
  instructions:
    "You are a weather assistant. When asked about the weather, use the get-weather tool " +
    "to fetch current conditions. Always provide temperature, conditions, and humidity.",
  model: openai("gpt-4o-mini"),
  tools: { getWeatherTool },
});

console.log("[tkt-2732 server] weatherAgent created:", {
  id: weatherAgent.id,
  name: weatherAgent.name,
});

// ---------------------------------------------------------------------------
// 3. Email agent — has weatherAgent as a SUB-AGENT
//
// This is the crux of the issue. The email agent is configured with
// `agents: { weatherAgent }`, which in Mastra means it can delegate to
// the weather agent via .network(). But CopilotKit calls .stream()
// instead, so the email agent has NO access to the weather sub-agent.
// ---------------------------------------------------------------------------

const emailAgent = new Agent({
  id: "email-agent",
  name: "Email Agent",
  description:
    "Drafts professional emails. Can use the weather agent to include " +
    "weather information in emails when needed.",
  instructions:
    "You are a professional email drafting assistant. " +
    "When the user asks you to draft an email that involves weather information, " +
    "use the Weather Agent (your sub-agent) to get the weather data first, " +
    "then compose the email with that information. " +
    "Format emails with Subject, To, and Body fields.",
  model: openai("gpt-4o-mini"),
  agents: { weatherAgent }, // <-- Sub-agent configuration
});

console.log("[tkt-2732 server] emailAgent created:", {
  id: emailAgent.id,
  name: emailAgent.name,
  subAgents: Object.keys((emailAgent as any).agents || {}),
});

// ---------------------------------------------------------------------------
// 4. Mastra instance — registers both agents
// ---------------------------------------------------------------------------

const mastra = new Mastra({
  agents: { weatherAgent, emailAgent },
});

const registeredAgents = Object.keys(mastra.listAgents?.() || {});
console.log("[tkt-2732 server] Mastra instance created. Registered agents:", registeredAgents);

// ---------------------------------------------------------------------------
// 5. CopilotKit integration
//
// MastraAgent.getLocalAgents() wraps each Mastra agent as an AbstractAgent
// for CopilotKit. Internally, when CopilotKit runs an agent, the
// MastraAgent wrapper calls agent.stream() — NOT agent.network().
//
// This means sub-agents configured via `agents: { ... }` are invisible
// to the LLM when going through CopilotKit.
// ---------------------------------------------------------------------------

const agents = MastraAgent.getLocalAgents({ mastra, resourceId: "tkt-2732" });
console.log("[tkt-2732 server] MastraAgent.getLocalAgents() returned:", Object.keys(agents));

const runtime = new CopilotRuntime({
  // @ts-expect-error - v1 CopilotRuntime types don't match AbstractAgent
  agents,
});

export const handler = copilotRuntimeNodeHttpEndpoint({
  runtime,
  serviceAdapter: new ExperimentalEmptyAdapter(),
  endpoint: "/api/tickets/tkt-2732/copilot",
});

console.log("[tkt-2732 server] Endpoint ready at /api/tickets/tkt-2732/copilot");
console.log("[tkt-2732 server] Frontend should use agent='emailAgent' to lock to email agent");
