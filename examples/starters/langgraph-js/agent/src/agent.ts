import { z } from "zod";
import { createAgent } from "langchain";
import {
  copilotkitMiddleware,
  CopilotKitStateSchema,
  zodState,
} from "@copilotkit/sdk-js/langgraph";
import { StateSchema } from "@langchain/langgraph";

import {
  stateItem,
  stateStreamingMiddleware,
} from "@copilotkit/sdk-js/langgraph-middlewares";

import { todo_tools, TodoSchema } from "./todos.js";
import { query_data } from "./query.js";
// Flight data, rendered as generative UI with render_ui
import { search_flights } from "./flights.js";
import { createChatModel } from "./model.js";

const AgentStateSchema = new StateSchema({
  todos: zodState(z.array(TodoSchema).default(() => [])),
  ...(CopilotKitStateSchema.fields as Record<string, any>),
});

// COPILOTKIT_AGENT_MODEL (e.g. "anthropic:claude-sonnet-4-5") overrides this
// and every other model site in the agent; unset, this site uses gpt-6-luna.
const model = createChatModel("openai:gpt-6-luna", {
  modelKwargs: { parallel_tool_calls: false },
});

export const graph = createAgent({
  model,
  tools: [query_data, ...todo_tools, search_flights],
  middleware: [
    copilotkitMiddleware,
    stateStreamingMiddleware(
      stateItem({
        stateKey: "todos",
        tool: "manage_todos",
        toolArgument: "todos",
      }),
    ),
  ],
  stateSchema: AgentStateSchema,
  systemPrompt: `
    You are a polished, professional demo assistant. Keep responses to 1-2 sentences.

    Tool guidance:
    - Flights: call search_flights, then show the flights with render_ui as a Row
      of FlightCard components.
    - Dashboards & rich UI: call render_ui to build dashboards with metrics, charts,
      tables, and cards from the generative UI catalog.
    - Charts: call query_data first, then render with the chart component.
    - Todos: enable app mode first, then manage todos.
    - Generative UI actions: a click on a button you rendered (e.g. selecting a
      flight) arrives as a user message. Respond with a brief confirmation.
  `,
});
