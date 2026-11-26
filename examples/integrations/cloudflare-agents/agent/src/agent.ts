/**
 * The starter's agent: a Cloudflare Agents SDK `Agent` made AG-UI-capable by
 * `withAGUI` from `@ag-ui/cloudflare-agents`.
 *
 * Each AG-UI thread is one instance of `Assistant`, a Durable Object, and the
 * agent's `state` is the thread's shared state: the todos the page shows in
 * App mode. When a tool calls `this.setState()`, the Durable Object keeps the
 * new state and the page gets it as a STATE_SNAPSHOT; the page's own edits
 * come back with the next run.
 *
 * The AI SDK does the model work. `run.streamTextOptions()` hands `streamText`
 * the conversation's messages, the page's context and shared state, and the
 * tools the page registers (the charts, the meeting picker, the theme toggle),
 * followed by the server tools below.
 */
import { Agent } from "agents";
import { withAGUI } from "@ag-ui/cloudflare-agents";
import type { AGUIRun } from "@ag-ui/cloudflare-agents";
import { stepCountIs, streamText, tool } from "ai";
import { z } from "zod";
import { generateA2ui, searchFlights } from "./a2ui";
import { createAgentModel } from "./model";
import type { ModelEnv } from "./model";
import financialData from "./db.json";

export interface Env extends ModelEnv {
  Assistant: DurableObjectNamespace<Assistant>;
}

interface Todo {
  id: string;
  title: string;
  description: string;
  emoji: string;
  status: "pending" | "completed";
}

/** The thread's shared state, as the page reads and writes it. */
export interface StarterState {
  todos?: Todo[];
}

const SYSTEM_PROMPT = `You are a polished, professional demo assistant. Keep responses to 1-2 sentences.

Tool guidance:

- Flights: call search_flights to show flight cards with a pre-built schema.
- Dashboards & rich UI: call generate_a2ui to create dashboard UIs with metrics,
  charts, tables, and cards. It handles rendering automatically.
- Charts: call query_data first, then render with the chart component.
- Todos: enable app mode first, then manage todos.
- A2UI actions: when you see a log_a2ui_event result (e.g. "view_details"),
  respond with a brief confirmation. The UI already updated on the frontend.`;

const todoInput = z.object({
  id: z.string().optional(),
  title: z.string(),
  description: z.string(),
  emoji: z.string(),
  status: z.enum(["pending", "completed"]).default("pending"),
});

export class Assistant extends withAGUI(Agent<Env, StarterState>) {
  initialState: StarterState = { todos: [] };

  onAGUIRun(run: AGUIRun<StarterState>) {
    const agentModel = () => createAgentModel(this.env);
    const { model, providerOptions } = agentModel();

    return streamText({
      model,
      ...run.streamTextOptions({
        instructions: SYSTEM_PROMPT,
        tools: {
          manage_todos: tool({
            description:
              "Replace the current todo list. Always pass the complete list, including unchanged todos.",
            inputSchema: z.object({ todos: z.array(todoInput) }),
            execute: async ({ todos }) => {
              const next = todos.map((todo) => ({
                ...todo,
                id: todo.id || crypto.randomUUID(),
              }));
              // Saved in the Durable Object, and streamed to the page.
              this.setState({ ...this.state, todos: next });
              return `Updated ${next.length} todo item(s).`;
            },
          }),
          get_todos: tool({
            description: "Read the current todo list from the shared state.",
            inputSchema: z.object({}),
            execute: async () => this.state.todos ?? [],
          }),
          query_data: tool({
            description:
              "Query the financial data. Always call this before asking the frontend to render a chart.",
            inputSchema: z.object({ query: z.string() }),
            execute: async () => financialData,
          }),
          search_flights: searchFlights,
          generate_a2ui: generateA2ui(agentModel, run.context),
        },
      }),
      providerOptions,
      stopWhen: stepCountIs(10),
    });
  }
}
