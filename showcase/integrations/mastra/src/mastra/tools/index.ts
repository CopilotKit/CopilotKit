// @region[backend-render-operations]
// @region[weather-tool-backend]
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
} from "@copilotkit/showcase-shared-tools";

// Re-export the dedicated tool sets defined in their own modules so the
// barrel keeps a single import surface for callers under `@/mastra/tools`.
export { setNotesTool } from "./shared-state-read-write";
export {
  researchAgentTool,
  writingAgentTool,
  critiqueAgentTool,
} from "./subagents";

export const weatherTool = createTool({
  id: "get_weather",
  description: "Get current weather for a location",
  inputSchema: z.object({
    location: z.string().describe("City name"),
  }),
  execute: async ({ location }) => JSON.stringify(getWeatherImpl(location)),
});
// @endregion[weather-tool-backend]

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
  execute: async ({ ticker: rawTicker }) => {
    const ticker = (rawTicker ?? "").toUpperCase();
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
  execute: async ({ query }) => JSON.stringify(queryDataImpl(query)),
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
  execute: async ({ todos }) => JSON.stringify(manageSalesTodosImpl(todos)),
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
  execute: async ({ currentTodos }) =>
    JSON.stringify(getSalesTodosImpl(currentTodos)),
});

export const scheduleMeetingTool = createTool({
  id: "schedule-meeting",
  description: "Schedule a meeting (requires user approval via HITL)",
  inputSchema: z.object({
    reason: z.string().describe("Reason for the meeting"),
    durationMinutes: z.number().optional().describe("Duration in minutes"),
  }),
  execute: async ({ reason, durationMinutes }) =>
    JSON.stringify(scheduleMeetingImpl(reason, durationMinutes)),
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
  execute: async ({ flights }) => JSON.stringify(searchFlightsImpl(flights)),
});

// The `generate-a2ui` tool runs a secondary LLM call with a forced
// `render_a2ui` tool, then converts that tool call's args into the
// A2UI `a2ui_operations` container that the middleware forwards to
// the frontend renderer. Mastra returns the operations as a JSON
// string from the tool body; the catalog
// (`copilotkit://generative-catalog`) resolves component names to
// React renderers on the client.
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
  execute: async ({ messages, contextEntries }) => {
    const prep = generateA2uiImpl({
      messages,
      contextEntries,
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
// @endregion[backend-render-operations]
