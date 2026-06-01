/**
 * A2UI Fixed Schema demo — backend agent constants.
 *
 * Mirrors `agents/a2ui_fixed.py` in the langgraph-python and ag2 references.
 * The component tree (schema) lives on the backend as JSON; the agent only
 * streams *data* into the data model at runtime via the `display_flight`
 * tool. The frontend catalog (see
 * `src/app/demos/a2ui-fixed-schema/a2ui/catalog.ts`) binds component names
 * from the JSON schema to React renderers.
 *
 * The dedicated runtime route at
 * `src/app/api/copilotkit-a2ui-fixed-schema/route.ts` runs the A2UI
 * middleware with `injectA2UITool: false` because this backend owns the
 * rendering tool itself.
 *
 * The schema is imported as JSON (resolveJsonModule: true in tsconfig) so
 * the build doesn't depend on filesystem layout at runtime.
 */

import type Anthropic from "@anthropic-ai/sdk";

import flightSchema from "./a2ui_schemas/flight_schema.json";

export const A2UI_FIXED_CATALOG_ID = "copilotkit://flight-fixed-catalog";
export const A2UI_FIXED_SURFACE_ID = "flight-fixed-schema";

export const FLIGHT_SCHEMA: unknown[] = flightSchema as unknown[];

export const A2UI_FIXED_SYSTEM_PROMPT =
  "You help users find flights. When asked about a flight, call " +
  "display_flight with origin (3-letter code), destination (3-letter " +
  "code), airline, and price (e.g. '$289'). Keep any chat reply to one " +
  "short sentence.";

export const DISPLAY_FLIGHT_TOOL_SCHEMA: Anthropic.Tool = {
  name: "display_flight",
  description:
    "Show a flight card for the given trip. Emits an a2ui_operations " +
    "container the frontend renders into a flight card via the fixed " +
    "schema catalog.",
  input_schema: {
    type: "object",
    properties: {
      origin: {
        type: "string",
        description: "Origin airport code, e.g. 'SFO'",
      },
      destination: {
        type: "string",
        description: "Destination airport code, e.g. 'JFK'",
      },
      airline: { type: "string", description: "Airline name, e.g. 'United'" },
      price: { type: "string", description: "Price string, e.g. '$289'" },
    },
    required: ["origin", "destination", "airline", "price"],
  },
};

/**
 * Build the `a2ui_operations` payload the A2UI runtime middleware
 * detects in tool results and forwards to the frontend renderer.
 */
export function buildDisplayFlightOperations(input: {
  origin: string;
  destination: string;
  airline: string;
  price: string;
}): { a2ui_operations: unknown[] } {
  return {
    a2ui_operations: [
      {
        type: "create_surface",
        surfaceId: A2UI_FIXED_SURFACE_ID,
        catalogId: A2UI_FIXED_CATALOG_ID,
      },
      {
        type: "update_components",
        surfaceId: A2UI_FIXED_SURFACE_ID,
        components: FLIGHT_SCHEMA,
      },
      {
        type: "update_data_model",
        surfaceId: A2UI_FIXED_SURFACE_ID,
        data: input,
      },
    ],
  };
}
