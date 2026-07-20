// @region[backend-render-operations]
// @region[weather-tool-backend]
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
// Use the header-forwarding `openai` so backend tool LLM calls (e.g.
// generateText inside generateA2ui) carry the inbound aimock context
// headers. See `_header_forwarding.ts`.
import { openai } from "@/mastra/_header_forwarding";
import { generateText, tool as aiTool } from "ai";
import {
  getWeatherImpl,
  queryDataImpl,
  scheduleMeetingImpl,
  searchFlightsImpl,
  generateA2uiImpl,
  buildA2uiOperationsFromToolCall,
} from "@copilotkit/showcase-shared-tools";

// `manage_todos` writes the todo list into working memory so the Beautiful
// Chat app-mode canvas (which reads `agent.state.todos`) renders it; `get_todos`
// reads it back. See working-memory.ts / OSS-452.
import {
  writeTodosToWorkingMemory,
  readTodosFromWorkingMemory,
} from "./working-memory";

// Re-export the dedicated tool sets defined in their own modules so the
// barrel keeps a single import surface for callers under `@/mastra/tools`.
export { setNotesTool } from "./shared-state-read-write";
export { setStepsTool } from "./gen-ui-agent";
export { scheduleMeetingInterruptTool } from "./interrupt";
export { browseWebTool } from "./browse-web";
export { runDeepResearchTool } from "./background-research";
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
  // Return the OBJECT, not JSON.stringify: the @ag-ui/mastra bridge encodes the
  // tool result exactly once on the way to the frontend, so stringifying here
  // double-encodes it and the typed cards' single-parse (parseJsonResult) reads
  // back a string with undefined fields ("--%"). Single-encode by returning the
  // object (same rule as browse_web / the Mastra capability-map memory).
  execute: async ({ location }) => getWeatherImpl(location),
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
    // Return an object (single-encode) — see weatherTool.
    return {
      ticker,
      price_usd: 189.42,
      change_pct: 1.27,
    };
  },
});

// Mock dice-roll tool used by the tool-rendering-reasoning-chain demo. Mirrors
// the langgraph-python `roll_dice` tool so the shared aimock fixtures can
// script a deterministic d20 → d6 chain. Rendered by the catch-all renderer.
export const rollDiceTool = createTool({
  id: "roll-dice",
  description: "Roll a single die with the given number of sides",
  inputSchema: z.object({
    sides: z
      .number()
      .optional()
      .describe("Number of sides on the die (default 6)"),
  }),
  execute: async ({ sides }) => {
    const s = typeof sides === "number" && sides > 1 ? Math.floor(sides) : 6;
    // Return an object (single-encode) — see weatherTool. The catchall
    // renderers (default/custom/reasoning-chain) JSON.parse once, so this also
    // renders cleanly there instead of an escaped double-encoded string.
    return {
      sides: s,
      result: Math.floor(Math.random() * s) + 1,
    };
  },
});

export const queryDataTool = createTool({
  id: "query-data",
  description: "Query financial database for chart data",
  inputSchema: z.object({
    query: z.string().describe("Natural language query"),
  }),
  // Return the object (single-encode) — see weatherTool.
  execute: async ({ query }) => queryDataImpl(query),
});

// Beautiful Chat task-manager tools. Ports langgraph-python's
// `manage_todos` / `get_todos` (src/agents/beautiful_chat.py) — the shared
// beautiful-chat frontend reads `agent.state.todos` (shape
// {id,title,description,emoji,status}) and the north-star uses these exact tool
// names. `manage_todos` WRITES the list into working memory so the @ag-ui/mastra
// adapter emits a STATE_SNAPSHOT and the app-mode canvas renders it — returning
// the JSON alone leaves the data only in the tool result, which never reaches
// agent state (OSS-452). Mastra previously shipped a mismatched sales-CRM tool
// (`manage_sales_todos`, shape {stage,value,completed}) that the frontend could
// not render and the recorded fixtures did not call.
const todoItemSchema = z.object({
  id: z.string().optional(),
  title: z.string(),
  description: z.string().optional(),
  emoji: z.string().optional(),
  status: z.enum(["pending", "completed"]).optional(),
});

/** Fill missing ids and default the frontend-required fields. */
function normalizeTodos(
  todos: Array<z.infer<typeof todoItemSchema>>,
): Array<Record<string, unknown>> {
  return todos.map((t, i) => ({
    id: t.id && t.id.length > 0 ? t.id : `todo-${Date.now()}-${i}`,
    title: t.title,
    description: t.description ?? "",
    emoji: t.emoji ?? "📝",
    status: t.status ?? "pending",
  }));
}

export const manageTodosTool = createTool({
  id: "manage_todos",
  description:
    "Create or update the task-manager todo list. Pass the FULL updated list " +
    "of todos; each todo has a title and optionally a description, emoji, and " +
    "status ('pending' or 'completed').",
  inputSchema: z.object({
    todos: z.array(todoItemSchema).describe("Full updated todo list"),
  }),
  execute: async (inputData, executionContext) => {
    const todos = normalizeTodos(inputData.todos ?? []);
    await writeTodosToWorkingMemory(executionContext, todos);
    return JSON.stringify({ todos, updated: true as const });
  },
});

export const getTodosTool = createTool({
  id: "get_todos",
  description: "Get the current task-manager todo list.",
  inputSchema: z.object({}),
  execute: async (_inputData, executionContext) => {
    const todos = await readTodosFromWorkingMemory(executionContext);
    return JSON.stringify({ todos });
  },
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
  // Return the object (single-encode) — see weatherTool.
  execute: async ({ flights }) => searchFlightsImpl(flights),
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

    // Normalize each incoming message role to the `user`/`assistant` pair
    // `generateText` accepts here. An unsound `as "user" | "assistant"` cast
    // would let a `system`/`tool` role slip through mis-typed (the `??` only
    // guards null/undefined), so map explicitly: anything that is not
    // `assistant` collapses to `user`.
    const toRole = (role: unknown): "user" | "assistant" =>
      role === "assistant" ? "assistant" : "user";

    const result = await generateText({
      model: openai("gpt-4.1"),
      system: prep.systemPrompt,
      messages: prep.messages.map((m) => ({
        role: toRole(m.role),
        content: (m.content as string) ?? "",
      })),
      tools: {
        render_a2ui: aiTool({
          description: "Render a dynamic A2UI v0.9 surface.",
          // AI SDK v5 renamed the tool schema key from `parameters` to
          // `inputSchema`; under v5 a `parameters` key is ignored, so the
          // render_a2ui schema would never reach the model.
          inputSchema: z.object({
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
      // The forced `render_a2ui` tool was not called, so there are no
      // operations to forward. Returning a `{ error }` JSON string would look
      // like a successful tool result to the frontend/runtime, which cannot
      // then distinguish it from a real A2UI payload. Throw instead so the
      // Mastra runtime surfaces this as a genuine tool error.
      const message = "generate-a2ui: LLM did not call render_a2ui";
      console.error(message, { finishReason: result.finishReason });
      throw new Error(message);
    }

    // AI SDK v5 renamed the typed tool-call arguments from `.args` to
    // `.input` (the `ai` v4 shape was `toolCall.args`). Read `.input` so the
    // a2ui builder gets the render_a2ui arguments instead of `undefined`.
    return JSON.stringify(
      buildA2uiOperationsFromToolCall(
        toolCall.input as Record<string, unknown>,
      ),
    );
  },
});
// @endregion[backend-render-operations]
