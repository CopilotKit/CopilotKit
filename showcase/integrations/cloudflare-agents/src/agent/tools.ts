/**
 * Server tools of the shared showcase agent, as AI SDK tools.
 *
 * The tool set and descriptions are the Strands TypeScript sibling's
 * (`strands-typescript/src/agent/tools.ts`); the implementations come from the
 * shared TypeScript tools (`shared-tools`). Where Strands derives AG-UI state
 * from a tool's arguments or result (its `toolBehaviors`), these tools write
 * the agent's state themselves: the Durable Object keeps it, and
 * `@ag-ui/cloudflare-agents` streams every change to the page as a
 * STATE_SNAPSHOT.
 *
 * Frontend tools (theme toggles, HITL components, generative-UI renderers) are
 * not defined here: they reach the model as `run.clientTools`.
 */
import { generateText, parsePartialJson, tool } from "ai";
import type { LanguageModel, ToolSet } from "ai";
import { z } from "zod";
import { getWeatherImpl } from "../../shared-tools/get-weather";
import { queryDataImpl } from "../../shared-tools/query-data";
import { scheduleMeetingImpl } from "../../shared-tools/schedule-meeting";
import { searchFlightsImpl } from "../../shared-tools/search-flights";
import { manageTodosImpl } from "../../shared-tools/todos";
import type { Flight } from "../../shared-tools/types";
import { SUBAGENT_SYSTEM_PROMPTS } from "./prompts";

/** The shared state the shared agent's tools read and write. */
export type ShowcaseState = Record<string, unknown>;

/** How a tool reaches the thread's state (the agent's `state` / `setState`). */
export interface StateAccess {
  get(): ShowcaseState;
  set(state: ShowcaseState): void;
}

/** Writes `patch` over the current state. */
function update(state: StateAccess, patch: ShowcaseState): void {
  state.set({ ...state.get(), ...patch });
}

/**
 * The board todos one `manage_sales_todos` call carries. A todo the model sent
 * without an id gets one derived from the call id, so retries name items the
 * same way.
 */
export function salesTodosForCall(
  todos: Record<string, unknown>[],
  toolCallId: string,
) {
  return manageTodosImpl(
    todos.map((todo, index) =>
      todo.id ? todo : { ...todo, id: `${toolCallId}-${index}` },
    ),
  );
}

/** Result text of a sub-agent call whose model request failed. */
export const SUBAGENT_FAILURE_PREFIX = "Sub-agent call failed";

type SubagentName = keyof typeof SUBAGENT_SYSTEM_PROMPTS;

interface Delegation {
  id: string;
  sub_agent: SubagentName;
  task: string;
  status: "completed" | "failed";
  result: string;
}

/**
 * One sub-agent: a single model call with its own system prompt. The
 * delegation lands in `state.delegations`, which the sub-agents page renders
 * as a live log.
 */
function subagentTool(
  name: SubagentName,
  description: string,
  model: () => LanguageModel,
  providerOptions: Parameters<typeof generateText>[0]["providerOptions"],
  state: StateAccess,
) {
  return tool({
    description,
    inputSchema: z.object({
      task: z.string().describe("The brief to hand off."),
    }),
    execute: async ({ task }, { abortSignal }) => {
      let delegation: Delegation;
      try {
        const { text } = await generateText({
          model: model(),
          system: SUBAGENT_SYSTEM_PROMPTS[name],
          prompt: task,
          providerOptions,
          abortSignal,
        });
        delegation = {
          id: crypto.randomUUID(),
          sub_agent: name,
          task,
          status: "completed",
          result: text.trim() || "(sub-agent returned no content)",
        };
      } catch (error) {
        const kind = error instanceof Error ? error.name : "Error";
        delegation = {
          id: crypto.randomUUID(),
          sub_agent: name,
          task,
          status: "failed",
          result: `${SUBAGENT_FAILURE_PREFIX} (${kind}).`,
        };
      }
      const previous = state.get().delegations;
      update(state, {
        delegations: [...(Array.isArray(previous) ? previous : []), delegation],
      });
      return delegation.result;
    },
  });
}

export interface ShowcaseToolsOptions {
  state: StateAccess;
  /** The chat model the sub-agents call. */
  model: () => LanguageModel;
  providerOptions?: Parameters<typeof generateText>[0]["providerOptions"];
}

/** The shared agent's server tools. */
export function showcaseTools({
  state,
  model,
  providerOptions,
}: ShowcaseToolsOptions): ToolSet {
  // write_document streams the document into state while the model is still
  // writing the call's arguments (shared-state-streaming).
  let documentArgs = "";

  return {
    get_sales_todos: tool({
      description: "Get the current sales pipeline todos.",
      inputSchema: z.object({}),
      execute: async () => {
        const todos = state.get().todos;
        return Array.isArray(todos) ? todos : [];
      },
    }),

    manage_sales_todos: tool({
      description:
        "Replace the complete board todo list. CRITICAL: Read get_sales_todos first. Copy existing ids exactly; omit id only for new items. Preserve unchanged titles, descriptions, emoji and metadata. Use status pending/completed, not the legacy completed boolean.",
      inputSchema: z.object({
        todos: z
          .array(
            z
              .object({
                id: z
                  .string()
                  .optional()
                  .describe(
                    "Copy the existing id exactly. Omit only for a new todo.",
                  ),
                title: z.string().describe("The task title."),
                description: z
                  .string()
                  .optional()
                  .describe(
                    "The user's task description or note. Preserve on updates.",
                  ),
                emoji: z.string().optional(),
                status: z.enum(["pending", "completed"]).optional(),
                stage: z.string().optional(),
                value: z.number().optional(),
                dueDate: z.string().optional(),
                assignee: z.string().optional(),
                completed: z
                  .boolean()
                  .optional()
                  .describe("Legacy input only; use status for board tasks."),
                notes: z.string().optional().describe("Legacy description."),
              })
              .passthrough(),
          )
          .describe("The complete updated list of sales todos."),
      }),
      execute: async ({ todos }, { toolCallId }) => {
        const board = salesTodosForCall(todos, toolCallId);
        update(state, { todos: board });
        return `Sales todos updated. Tracking ${board.length} item(s).`;
      },
    }),

    get_weather: tool({
      description: "Get current weather for a location.",
      inputSchema: z.object({
        location: z.string().describe("The location to get weather for."),
      }),
      execute: async ({ location }) => getWeatherImpl(location),
    }),

    query_data: tool({
      description:
        "Query the financial database for chart data. Always call before showing a chart or graph.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("Natural language query for financial data."),
      }),
      execute: async ({ query }) => queryDataImpl(query),
    }),

    roll_dice: tool({
      description:
        "Roll a die with the given number of sides and return the result. Use for any dice-rolling request (e.g. 'roll a d20' → sides=20).",
      inputSchema: z.object({
        sides: z
          .number()
          .int()
          .min(2)
          .max(1000)
          .describe("Number of sides (e.g. 20 for a d20)."),
      }),
      execute: async ({ sides }) => ({
        sides,
        result: 1 + Math.floor(Math.random() * sides),
      }),
    }),

    schedule_meeting: tool({
      description:
        "Schedule a meeting with user approval. The user picks a time in the UI.",
      inputSchema: z.object({
        reason: z.string().describe("Reason for the meeting."),
      }),
      execute: async ({ reason }) => scheduleMeetingImpl(reason),
    }),

    search_flights: tool({
      description:
        'Search for flights and display the results as rich cards. Return exactly 2 flights. Each flight must have: airline, airlineLogo, flightNumber, origin, destination, date (short readable format like "Tue, Mar 18" -- use near-future dates), departureTime, arrivalTime, duration (e.g. "4h 25m"), status (e.g. "On Time" or "Delayed"), statusColor (hex color for status dot), price (e.g. "$289"), and currency (e.g. "USD"). For airlineLogo use the Google favicon API: https://www.google.com/s2/favicons?domain={airline_domain}&sz=128',
      inputSchema: z.object({
        flights: z
          .array(z.record(z.string(), z.unknown()))
          .describe("List of flight objects."),
      }),
      execute: async ({ flights }) =>
        searchFlightsImpl(flights as unknown as Flight[]),
    }),

    set_theme_color: tool({
      description:
        "Change the theme color of the UI. This is rendered on the frontend.",
      inputSchema: z.object({
        theme_color: z.string().describe("The color to set as theme."),
      }),
      execute: async ({ theme_color }) => `Theme color set to ${theme_color}.`,
    }),

    set_notes: tool({
      description:
        "Replace the notes array in shared state with the full updated list. Use whenever the user asks you to remember something. ALWAYS pass the FULL notes list (existing + new), not a diff. Keep each note short (< 120 chars).",
      inputSchema: z.object({
        notes: z
          .array(z.string())
          .describe("The complete updated list of short note strings."),
      }),
      execute: async ({ notes }) => {
        update(state, { notes });
        return `Notes updated. Tracking ${notes.length} note(s).`;
      },
    }),

    set_steps: tool({
      description:
        'Publish the current plan and step statuses. Call every time a step transitions (including the first enumeration). ALWAYS pass the COMPLETE list of steps. Each step is { id: string, title: string, status: "pending" | "in_progress" | "completed" }.',
      inputSchema: z.object({
        steps: z
          .array(
            z.object({ id: z.string(), title: z.string(), status: z.string() }),
          )
          .describe("The complete list of steps with current statuses."),
      }),
      execute: async ({ steps }) => {
        update(state, { steps });
        return `Published ${steps.length} step(s).`;
      },
    }),

    write_document: tool({
      description:
        "Write a document for the user. Call this whenever the user asks you to write, draft, or revise any piece of text (a poem, email, essay, summary, etc.). Pass the FULL content as a single string in the `document` argument — the document lives in shared state and the UI renders it live; never paste it into a chat message.",
      inputSchema: z.object({
        document: z
          .string()
          .describe("The full document content as a single string."),
      }),
      onInputStart: () => {
        documentArgs = "";
      },
      // The document reaches the page as the model writes it, not only once
      // the call is complete.
      onInputDelta: async ({ inputTextDelta }) => {
        documentArgs += inputTextDelta;
        const { value } = await parsePartialJson(documentArgs);
        const document = (value as { document?: unknown } | undefined)
          ?.document;
        if (typeof document === "string" && document !== state.get().document) {
          update(state, { document });
        }
      },
      execute: async ({ document }) => {
        // Usually streamed in full already; write only what is still missing.
        if (state.get().document !== document) update(state, { document });
        return "Document written to shared state.";
      },
    }),

    research_agent: subagentTool(
      "research_agent",
      "Delegate a research task to the research sub-agent. Use for gathering facts, background, definitions, statistics. Returns a bulleted list of key facts.",
      model,
      providerOptions,
      state,
    ),
    writing_agent: subagentTool(
      "writing_agent",
      "Delegate a drafting task to the writing sub-agent. Use for producing a polished paragraph, draft, or summary. Pass relevant facts inside `task`.",
      model,
      providerOptions,
      state,
    ),
    critique_agent: subagentTool(
      "critique_agent",
      "Delegate a critique task to the critique sub-agent. Use for reviewing a draft and suggesting concrete improvements.",
      model,
      providerOptions,
      state,
    ),
  };
}
