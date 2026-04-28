/**
 * LangGraph TypeScript agent for the Declarative Generative UI (A2UI — Fixed Schema) demo.
 *
 * Fixed-schema A2UI: the component tree (schema) is authored ahead of time as
 * JSON and loaded at startup. The agent only streams *data* into the data model
 * at runtime. The frontend registers a matching catalog that pins the schema's
 * component names to real React implementations.
 *
 * Ported from `src/agents/a2ui_fixed.py`.
 */

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { z } from "zod";
import { RunnableConfig } from "@langchain/core/runnables";
import { tool } from "@langchain/core/tools";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AIMessage, SystemMessage } from "@langchain/core/messages";
import {
  MemorySaver,
  START,
  StateGraph,
  Annotation,
} from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import {
  convertActionsToDynamicStructuredTools,
  CopilotKitStateAnnotation,
} from "@copilotkit/sdk-js/langgraph";

const CATALOG_ID = "copilotkit://flight-fixed-catalog";
const SURFACE_ID = "flight-fixed-schema";
const A2UI_OPERATIONS_KEY = "a2ui_operations";

// @region[backend-schema-json-load]
// Schemas are JSON so they can be authored and reviewed independently of the
// agent code.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCHEMAS_DIR = join(__dirname, "a2ui_schemas");

function loadSchema(filename: string): unknown[] {
  const full = join(SCHEMAS_DIR, filename);
  return JSON.parse(readFileSync(full, "utf-8")) as unknown[];
}

const FLIGHT_SCHEMA = loadSchema("flight_schema.json");
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const BOOKED_SCHEMA = loadSchema("booked_schema.json");
// @endregion[backend-schema-json-load]

const AgentStateAnnotation = Annotation.Root({
  ...CopilotKitStateAnnotation.spec,
});

export type AgentState = typeof AgentStateAnnotation.State;

function createSurfaceOp(surfaceId: string, catalogId: string) {
  return {
    version: "v0.9",
    createSurface: { surfaceId, catalogId },
  };
}

function updateComponentsOp(surfaceId: string, components: unknown[]) {
  return {
    version: "v0.9",
    updateComponents: { surfaceId, components },
  };
}

function updateDataModelOp(
  surfaceId: string,
  data: unknown,
  path: string = "/",
) {
  return {
    version: "v0.9",
    updateDataModel: { surfaceId, path, value: data },
  };
}

function renderA2uiOperations(operations: unknown[]): string {
  return JSON.stringify({ [A2UI_OPERATIONS_KEY]: operations });
}

// @region[backend-render-operations]
const displayFlight = tool(
  async ({
    origin,
    destination,
    airline,
    price,
  }: {
    origin: string;
    destination: string;
    airline: string;
    price: string;
  }) => {
    return renderA2uiOperations([
      createSurfaceOp(SURFACE_ID, CATALOG_ID),
      updateComponentsOp(SURFACE_ID, FLIGHT_SCHEMA),
      updateDataModelOp(SURFACE_ID, { origin, destination, airline, price }),
    ]);
  },
  {
    name: "display_flight",
    description:
      'Show a flight card for the given trip. Use short airport codes (e.g. "SFO", "JFK") for origin/destination and a price string like "$289".',
    schema: z.object({
      origin: z.string(),
      destination: z.string(),
      airline: z.string(),
      price: z.string(),
    }),
  },
);
// @endregion[backend-render-operations]

const tools = [displayFlight];

const SYSTEM_PROMPT =
  "You help users find flights. When asked about a flight, call " +
  "display_flight with origin, destination, airline, and price. " +
  "Keep any chat reply to one short sentence.";

async function chatNode(state: AgentState, config: RunnableConfig) {
  const model = new ChatOpenAI({ temperature: 0, model: "gpt-4o-mini" });

  const modelWithTools = model.bindTools!([
    ...convertActionsToDynamicStructuredTools(state.copilotkit?.actions ?? []),
    ...tools,
  ]);

  const systemMessage = new SystemMessage({ content: SYSTEM_PROMPT });

  const response = await modelWithTools.invoke(
    [systemMessage, ...state.messages],
    config,
  );

  return { messages: response };
}

function shouldContinue({ messages, copilotkit }: AgentState) {
  const lastMessage = messages[messages.length - 1] as AIMessage;

  if (lastMessage.tool_calls?.length) {
    const actions = copilotkit?.actions;
    const toolCallName = lastMessage.tool_calls![0].name;

    if (!actions || actions.every((action) => action.name !== toolCallName)) {
      return "tool_node";
    }
  }

  return "__end__";
}

const workflow = new StateGraph(AgentStateAnnotation)
  .addNode("chat_node", chatNode)
  .addNode("tool_node", new ToolNode(tools))
  .addEdge(START, "chat_node")
  .addEdge("tool_node", "chat_node")
  .addConditionalEdges("chat_node", shouldContinue as any);

const memory = new MemorySaver();

export const graph = workflow.compile({
  checkpointer: memory,
});
