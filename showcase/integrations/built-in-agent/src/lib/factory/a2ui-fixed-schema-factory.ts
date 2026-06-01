import { BuiltInAgent, convertInputToTanStackAI } from "@copilotkit/runtime/v2";
import { chat, toolDefinition } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import { z } from "zod";

const CATALOG_ID = "copilotkit://flight-fixed-catalog";
const SURFACE_ID = "flight-fixed-schema";
const A2UI_OPERATIONS_KEY = "a2ui_operations";

// Fixed flight-card schema. Inlined as a TS const so it ships into the
// Next.js route bundle without runtime fs access. Mirrors
// `showcase/integrations/langgraph-python/src/agents/a2ui_schemas/flight_schema.json`.
// @region[backend-schema]
const FLIGHT_SCHEMA: unknown[] = [
  { id: "root", component: "Card", child: "content" },
  {
    id: "content",
    component: "Column",
    children: ["title", "route", "meta", "bookButton"],
  },
  { id: "title", component: "Title", text: "Flight Details" },
  {
    id: "route",
    component: "Row",
    justify: "spaceBetween",
    align: "center",
    children: ["from", "arrow", "to"],
  },
  { id: "from", component: "Airport", code: { path: "/origin" } },
  { id: "arrow", component: "Arrow" },
  { id: "to", component: "Airport", code: { path: "/destination" } },
  {
    id: "meta",
    component: "Row",
    justify: "spaceBetween",
    align: "center",
    children: ["airline", "price"],
  },
  {
    id: "airline",
    component: "AirlineBadge",
    name: { path: "/airline" },
  },
  { id: "price", component: "PriceTag", amount: { path: "/price" } },
  {
    id: "bookButton",
    component: "Button",
    variant: "primary",
    child: "bookButtonLabel",
    action: {
      event: {
        name: "book_flight",
        context: {
          origin: { path: "/origin" },
          destination: { path: "/destination" },
          airline: { path: "/airline" },
          price: { path: "/price" },
        },
      },
    },
  },
  { id: "bookButtonLabel", component: "Text", text: "Book flight" },
];
// @endregion[backend-schema]

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

function renderA2uiOperations(operations: unknown[]) {
  return { [A2UI_OPERATIONS_KEY]: operations };
}

// @region[display-flight-tool]
// `display_flight` returns an `a2ui_operations` container directly. The runtime's
// A2UI middleware (configured with `injectA2UITool: false`) detects this shape
// in the tool result and forwards the operations to the frontend renderer, which
// resolves component names against the registered catalog.
const displayFlightTool = toolDefinition({
  name: "display_flight",
  description:
    'Show a flight card for the given trip. Use short airport codes (e.g. "SFO", "JFK") for origin/destination and a price string like "$289".',
  inputSchema: z.object({
    origin: z.string(),
    destination: z.string(),
    airline: z.string(),
    price: z.string(),
  }),
}).server(async ({ origin, destination, airline, price }) =>
  renderA2uiOperations([
    createSurfaceOp(SURFACE_ID, CATALOG_ID),
    updateComponentsOp(SURFACE_ID, FLIGHT_SCHEMA),
    updateDataModelOp(SURFACE_ID, { origin, destination, airline, price }),
  ]),
);
// @endregion[display-flight-tool]

const A2UI_FIXED_SCHEMA_SYSTEM_PROMPT = `\
You help users find flights. When asked about a flight, call display_flight \
with origin, destination, airline, and price. Keep any chat reply to one \
short sentence.`;

/**
 * Built-in agent for the A2UI Fixed Schema demo.
 *
 * The frontend owns the component tree (a fixed JSON schema is
 * `updateComponents`'d once at render time); the agent only streams *data* into
 * the data model via the `display_flight` tool.
 */
export function createA2UIFixedSchemaAgent() {
  return new BuiltInAgent({
    type: "tanstack",
    factory: ({ input, abortController }) => {
      const { messages, systemPrompts } = convertInputToTanStackAI(input);
      return chat({
        adapter: openaiText("gpt-4o-mini"),
        messages,
        systemPrompts: [A2UI_FIXED_SCHEMA_SYSTEM_PROMPT, ...systemPrompts],
        tools: [displayFlightTool],
        abortController,
      });
    },
  });
}
