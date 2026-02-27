import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkitnext/runtime";
import { TranscriptionServiceOpenAI } from "@copilotkit/voice";
import { handle } from "hono/vercel";
import { BuiltInAgent, defineTool } from "@copilotkitnext/agent";
import OpenAI from "openai";
import { z } from "zod";

const determineModel = () => {
  if (process.env.OPENAI_API_KEY?.trim()) {
    return "openai/gpt-5.2";
  }
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return "anthropic/claude-sonnet-4.5";
  }
  if (process.env.GOOGLE_API_KEY?.trim()) {
    return "google/gemini-2.5-pro";
  }
  return "openai/gpt-5.2";
};

const getWeather = defineTool({
  name: "getWeather",
  description: "Get the current weather for a location",
  parameters: z.object({
    city: z.string().describe("The city name"),
    unit: z
      .enum(["celsius", "fahrenheit"])
      .optional()
      .describe("Temperature unit"),
  }),
  execute: async ({ city, unit }) => {
    return { city, temperature: 22, unit: unit ?? "celsius" };
  },
});

const searchDocuments = defineTool({
  name: "searchDocuments",
  description: "Search through documents for relevant information",
  parameters: z.object({
    query: z.string().describe("The search query"),
    maxResults: z
      .number()
      .optional()
      .describe("Maximum number of results to return"),
  }),
  execute: async ({ query, maxResults }) => {
    return { query, results: [], maxResults: maxResults ?? 10 };
  },
});

const createEvent = defineTool({
  name: "createEvent",
  description: "Create a calendar event",
  parameters: z.object({
    title: z.string().describe("Event title"),
    date: z.string().describe("Event date in ISO format"),
    attendees: z
      .array(z.string())
      .optional()
      .describe("List of attendee emails"),
  }),
  execute: async ({ title, date, attendees }) => {
    return { title, date, attendees: attendees ?? [], id: "evt_123" };
  },
});

// Deliberately shares the "getWeather" name with the default agent to test conflict handling
const getWeatherV2 = defineTool({
  name: "getWeather",
  description: "Get weather forecast for a location (extended)",
  parameters: z.object({
    city: z.string().describe("The city name"),
    days: z.number().optional().describe("Number of forecast days"),
  }),
  execute: async ({ city, days }) => {
    return { city, forecast: [], days: days ?? 3 };
  },
});

const defaultAgent = new BuiltInAgent({
  model: determineModel(),
  prompt:
    "You are a helpful AI assistant. Use reasoning to answer the user's question. If you don't know the answer, say you don't know.",
  providerOptions: {
    openai: { reasoningEffort: "high", reasoningSummary: "detailed" },
  },
  tools: [getWeather, searchDocuments],
});

const plannerAgent = new BuiltInAgent({
  model: determineModel(),
  description: "An agent that helps plan events and check weather forecasts",
  prompt:
    "You are a planning assistant. Help users create events and check weather.",
  tools: [createEvent, getWeatherV2],
});

// Set up transcription service if OpenAI API key is available
const transcriptionService = process.env.OPENAI_API_KEY?.trim()
  ? new TranscriptionServiceOpenAI({
      openai: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
    })
  : undefined;

const honoRuntime = new CopilotRuntime({
  agents: {
    default: defaultAgent,
    planner: plannerAgent,
  },
  runner: new InMemoryAgentRunner(),
  transcriptionService,
});

const app = createCopilotEndpoint({
  runtime: honoRuntime,
  basePath: "/api/copilotkit",
});

export const GET = handle(app);
export const POST = handle(app);
