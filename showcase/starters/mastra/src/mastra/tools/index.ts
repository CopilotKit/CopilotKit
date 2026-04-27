import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { openai } from "@ai-sdk/openai";
import { generateText, tool as aiTool } from "ai";
import {
  getWeatherImpl,
  queryDataImpl,
  manageSalesTodosImpl,
  getSalesTodosImpl,
  scheduleMeetingImpl,
  searchFlightsImpl,
  generateA2uiImpl,
  buildA2uiOperationsFromToolCall,
} from "../shared-tools";

export const weatherTool = createTool({
  id: "get-weather",
  description: "Get current weather for a location",
  inputSchema: z.object({
    location: z.string().describe("City name"),
  }),
  execute: async ({ context }) =>
    JSON.stringify(getWeatherImpl(context.location)),
});

// Mock stock-price tool used by the headless-complete demo to exercise the
// manual `useRenderTool` path alongside `get_weather`. Returns a fixed
// payload so the StockCard renders deterministically without a real market
// data API.
export const stockPriceTool = createTool({
  id: "get-stock-price",
  description: "Get a mock current price for a stock ticker",
  inputSchema: z.object({
    ticker: z.string().describe("Stock ticker symbol, e.g. AAPL"),
  }),
  execute: async ({ context }) => {
    const ticker = (context.ticker ?? "").toUpperCase();
    return JSON.stringify({
      ticker,
      price_usd: 189.42,
      change_pct: 1.27,
    });
  },
});

export const queryDataTool = createTool({
  id: "query-data",
  description: "Query financial database for chart data",
  inputSchema: z.object({
    query: z.string().describe("Natural language query"),
  }),
  execute: async ({ context }) => JSON.stringify(queryDataImpl(context.query)),
});

export const manageSalesTodosTool = createTool({
  id: "manage-sales-todos",
  description: "Create or update the sales todo list",
  inputSchema: z.object({
    todos: z
      .array(
        z.object({
          id: z.string().optional(),
          title: z.string(),
          stage: z.string().optional(),
          value: z.number().optional(),
          dueDate: z.string().optional(),
          assignee: z.string().optional(),
          completed: z.boolean().optional(),
        }),
      )
      .describe("Array of sales todo items"),
  }),
  execute: async ({ context }) =>
    JSON.stringify(manageSalesTodosImpl(context.todos)),
});

export const getSalesTodosTool = createTool({
  id: "get-sales-todos",
  description: "Get the current sales todo list",
  inputSchema: z.object({
    currentTodos: z
      .array(
        z.object({
          id: z.string().optional(),
          title: z.string().optional(),
          stage: z.string().optional(),
          value: z.number().optional(),
          dueDate: z.string().optional(),
          assignee: z.string().optional(),
          completed: z.boolean().optional(),
        }),
      )
      .optional()
      .nullable()
      .describe("Current todos if any"),
  }),
  execute: async ({ context }) =>
    JSON.stringify(getSalesTodosImpl(context.currentTodos)),
});

export const scheduleMeetingTool = createTool({
  id: "schedule-meeting",
  description: "Schedule a meeting (requires user approval via HITL)",
  inputSchema: z.object({
    reason: z.string().describe("Reason for the meeting"),
    durationMinutes: z.number().optional().describe("Duration in minutes"),
  }),
  execute: async ({ context }) =>
    JSON.stringify(
      scheduleMeetingImpl(context.reason, context.durationMinutes),
    ),
});

export const searchFlightsTool = createTool({
  id: "search-flights",
  description: "Search for available flights",
  inputSchema: z.object({
    flights: z
      .array(
        z.object({
          airline: z.string(),
          airlineLogo: z.string().optional(),
          flightNumber: z.string(),
          origin: z.string(),
          destination: z.string(),
          date: z.string(),
          departureTime: z.string(),
          arrivalTime: z.string(),
          duration: z.string(),
          status: z.string(),
          statusColor: z.string().optional(),
          price: z.string(),
          currency: z.string().optional(),
        }),
      )
      .describe("Array of flight results"),
  }),
  execute: async ({ context }) =>
    JSON.stringify(searchFlightsImpl(context.flights)),
});

export const generateA2uiTool = createTool({
  id: "generate-a2ui",
  description: "Generate dynamic A2UI surface components",
  inputSchema: z.object({
    messages: z.array(z.record(z.unknown())).describe("Chat messages"),
    contextEntries: z
      .array(z.record(z.unknown()))
      .optional()
      .describe("Context entries"),
  }),
  execute: async ({ context }) => {
    const prep = generateA2uiImpl({
      messages: context.messages,
      contextEntries: context.contextEntries,
    });

    const result = await generateText({
      model: openai("gpt-4.1"),
      system: prep.systemPrompt,
      messages: prep.messages.map((m) => ({
        role: (m.role as "user" | "assistant") ?? "user",
        content: (m.content as string) ?? "",
      })),
      tools: {
        render_a2ui: aiTool({
          description: "Render a dynamic A2UI v0.9 surface.",
          parameters: z.object({
            surfaceId: z.string().describe("Unique surface identifier."),
            catalogId: z.string().describe("The catalog ID."),
            components: z
              .array(z.record(z.unknown()))
              .describe("A2UI v0.9 component array."),
            data: z
              .record(z.unknown())
              .optional()
              .describe("Optional initial data model."),
          }),
        }),
      },
      toolChoice: { type: "tool", toolName: "render_a2ui" },
    });

    const toolCall = result.toolCalls?.[0];
    if (!toolCall) {
      return JSON.stringify({ error: "LLM did not call render_a2ui" });
    }

    return JSON.stringify(
      buildA2uiOperationsFromToolCall(toolCall.args as Record<string, unknown>),
    );
  },
});
