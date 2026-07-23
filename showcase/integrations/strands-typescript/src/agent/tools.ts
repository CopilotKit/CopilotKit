/**
 * Strands `tool()` definitions for the shared showcase agent.
 *
 * Mirrors the Python sibling's tool set (`src/agents/agent.py`) minus the
 * A2UI `generate_a2ui` tool. Frontend-only tools (theme toggles, HITL
 * components) are NOT defined here — the @ag-ui/aws-strands adapter
 * auto-registers them as proxy tools from `RunAgentInput.tools`, so the LLM
 * sees them and the browser executes them.
 */

import { tool } from "@strands-agents/sdk";
import OpenAI from "openai";
import { z } from "zod";
import { AIMOCK_CONTEXT } from "./model-factory";
import { forwardingFetch } from "./header-forwarding.js";
import { SUBAGENT_FAILURE_MARKER } from "./state";
import {
  getWeatherImpl,
  manageSalesTodosImpl,
  queryDataImpl,
  rollDiceImpl,
  scheduleMeetingImpl,
  searchFlightsImpl,
} from "./lib/tool-impls";
import type { Flight } from "./lib/tool-impls";

export const getWeather = tool({
  name: "get_weather",
  description: "Get current weather for a location.",
  inputSchema: z.object({
    location: z.string().describe("The location to get weather for."),
  }),
  callback: ({ location }) => JSON.stringify(getWeatherImpl(location)),
});

export const queryData = tool({
  name: "query_data",
  description:
    "Query the financial database for chart data. Always call before showing a chart or graph.",
  inputSchema: z.object({
    query: z.string().describe("Natural language query for financial data."),
  }),
  callback: ({ query }) => JSON.stringify(queryDataImpl(query)),
});

export const manageSalesTodos = tool({
  name: "manage_sales_todos",
  description:
    "Manage the sales pipeline by replacing the entire list of todos. ALWAYS provide the entire list, not just new items.",
  inputSchema: z.object({
    todos: z
      .array(z.record(z.string(), z.unknown()))
      .describe("The complete updated list of sales todos."),
  }),
  callback: ({ todos }) => {
    const result = manageSalesTodosImpl(todos as never[]);
    return `Sales todos updated. Tracking ${result.length} item(s).`;
  },
});

export const getSalesTodos = tool({
  name: "get_sales_todos",
  description: "Get the current sales pipeline todos.",
  inputSchema: z.object({}),
  callback: () => "Check the sales pipeline provided in the context.",
});

export const scheduleMeeting = tool({
  name: "schedule_meeting",
  description:
    "Schedule a meeting with user approval. The user picks a time in the UI.",
  inputSchema: z.object({
    reason: z.string().describe("Reason for the meeting."),
  }),
  callback: ({ reason }) => JSON.stringify(scheduleMeetingImpl(reason)),
});

export const searchFlights = tool({
  name: "search_flights",
  description:
    'Search for flights and display the results as rich cards. Return exactly 2 flights. Each flight must have: airline, airlineLogo, flightNumber, origin, destination, date (short readable format like "Tue, Mar 18" -- use near-future dates), departureTime, arrivalTime, duration (e.g. "4h 25m"), status (e.g. "On Time" or "Delayed"), statusColor (hex color for status dot), price (e.g. "$289"), and currency (e.g. "USD"). For airlineLogo use the Google favicon API: https://www.google.com/s2/favicons?domain={airline_domain}&sz=128',
  inputSchema: z.object({
    flights: z
      .array(z.record(z.string(), z.unknown()))
      .describe("List of flight objects."),
  }),
  callback: ({ flights }) =>
    JSON.stringify(searchFlightsImpl(flights as unknown as Flight[])),
});

export const rollDice = tool({
  name: "roll_dice",
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
  callback: ({ sides }) => JSON.stringify(rollDiceImpl(sides)),
});

export const setThemeColor = tool({
  name: "set_theme_color",
  description:
    "Change the theme color of the UI. This is rendered on the frontend.",
  inputSchema: z.object({
    theme_color: z.string().describe("The color to set as theme."),
  }),
  callback: ({ theme_color }) => `Theme color set to ${theme_color}.`,
});

export const setNotes = tool({
  name: "set_notes",
  description:
    "Replace the notes array in shared state with the full updated list. Use whenever the user asks you to remember something. ALWAYS pass the FULL notes list (existing + new), not a diff. Keep each note short (< 120 chars).",
  inputSchema: z.object({
    notes: z
      .array(z.string())
      .describe("The complete updated list of short note strings."),
  }),
  callback: ({ notes }) => `Notes updated. Tracking ${notes.length} note(s).`,
});

export const setSteps = tool({
  name: "set_steps",
  description:
    'Publish the current plan and step statuses. Call every time a step transitions (including the first enumeration). ALWAYS pass the COMPLETE list of steps. Each step is { id: string, title: string, status: "pending" | "in_progress" | "completed" }.',
  inputSchema: z.object({
    steps: z
      .array(
        z.object({
          id: z.string(),
          title: z.string(),
          status: z.string(),
        }),
      )
      .describe("The complete list of steps with current statuses."),
  }),
  callback: ({ steps }) => `Published ${steps.length} step(s).`,
});

export const writeDocument = tool({
  name: "write_document",
  description:
    "Write a document for the user. Call this whenever the user asks you to write, draft, or revise any piece of text (a poem, email, essay, summary, etc.). Pass the FULL content as a single string in the `document` argument — the document lives in shared state and the UI renders it live; never paste it into a chat message.",
  inputSchema: z.object({
    document: z
      .string()
      .describe("The full document content as a single string."),
  }),
  callback: () => "Document written to shared state.",
});

// ---- Sub-agents ----------------------------------------------------------

const SUBAGENT_SYSTEM_PROMPTS: Record<string, string> = {
  research_agent:
    "You are a research sub-agent. Given a topic, produce a concise bulleted list of 3-5 key facts. No preamble, no closing.",
  writing_agent:
    "You are a writing sub-agent. Given a brief and optional source facts, produce a polished 1-paragraph draft. Be clear and concrete. No preamble.",
  critique_agent:
    "You are an editorial critique sub-agent. Given a draft, give 2-3 crisp, actionable critiques. No preamble.",
};

const SUBAGENT_EMPTY_RESULT = "(sub-agent returned no content)";

let _openaiClient: OpenAI | null = null;
export function openaiClient(): OpenAI {
  if (!_openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY must be set for sub-agent delegation.");
    }
    _openaiClient = new OpenAI({
      apiKey,
      ...(process.env.OPENAI_BASE_URL
        ? { baseURL: process.env.OPENAI_BASE_URL }
        : {}),
      // Match the shared agent so sub-agent calls hit the right aimock fixtures.
      defaultHeaders: { "x-aimock-context": AIMOCK_CONTEXT },
      // Per-request inbound x-* forwarding (incl. X-AIMock-Strict / x-test-id /
      // x-diag-*), mirroring model-factory.ts. The sub-agent client is built
      // ONCE (memoized), but forwardingFetch reads an AsyncLocalStorage
      // snapshot per outbound call (seeded by the Express cvdiag/forwarding
      // middleware around agent.run()), so per-request headers flow correctly.
      // It never clobbers the static x-aimock-context above, and is
      // byte-identical to a plain fetch when no x-* are in scope (demo traffic
      // unaffected).
      fetch: forwardingFetch,
    });
  }
  return _openaiClient;
}

/**
 * Run a single-shot completion as a sub-agent. Returns the failure marker
 * (caught in `state.ts`) on transport/API errors rather than throwing, so a
 * delegation failure surfaces as a "failed" log row instead of a 500.
 */
async function runSubagent(name: string, task: string): Promise<string> {
  const systemPrompt = SUBAGENT_SYSTEM_PROMPTS[name];
  try {
    const response = await openaiClient().chat.completions.create({
      model: process.env.SUBAGENT_MODEL_ID ?? "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: task },
      ],
    });
    const content = response.choices[0]?.message?.content ?? "";
    const text = content.trim();
    return text || SUBAGENT_EMPTY_RESULT;
  } catch (err) {
    const cls = err instanceof Error ? err.constructor.name : "Error";
    return `${SUBAGENT_FAILURE_MARKER}${cls}`;
  }
}

export const researchAgent = tool({
  name: "research_agent",
  description:
    "Delegate a research task to the research sub-agent. Use for gathering facts, background, definitions, statistics. Returns a bulleted list of key facts.",
  inputSchema: z.object({
    task: z.string().describe("The research brief to hand off."),
  }),
  callback: ({ task }) => runSubagent("research_agent", task),
});

export const writingAgent = tool({
  name: "writing_agent",
  description:
    "Delegate a drafting task to the writing sub-agent. Use for producing a polished paragraph, draft, or summary. Pass relevant facts inside `task`.",
  inputSchema: z.object({
    task: z.string().describe("The writing brief to hand off."),
  }),
  callback: ({ task }) => runSubagent("writing_agent", task),
});

export const critiqueAgent = tool({
  name: "critique_agent",
  description:
    "Delegate a critique task to the critique sub-agent. Use for reviewing a draft and suggesting concrete improvements.",
  inputSchema: z.object({
    task: z.string().describe("The draft to critique."),
  }),
  callback: ({ task }) => runSubagent("critique_agent", task),
});

/** Full tool set for the shared showcase agent. */
export const SHOWCASE_TOOLS = [
  getSalesTodos,
  manageSalesTodos,
  getWeather,
  queryData,
  rollDice,
  scheduleMeeting,
  searchFlights,
  setThemeColor,
  setNotes,
  setSteps,
  writeDocument,
  researchAgent,
  writingAgent,
  critiqueAgent,
];
