/**
 * The agent's A2UI tools. Each returns an `a2ui_operations` envelope as its
 * result; CopilotKit's runtime finds it in the tool result and the page paints
 * the surface with its A2UI catalog (src/app/declarative-generative-ui/).
 *
 * - `search_flights`: a pre-built flight-card surface filled with the model's
 *   flights (fixed schema).
 * - `generate_a2ui`: a second model call designs a dashboard surface (dynamic
 *   schema), from the catalog schema and guidelines the runtime sends as
 *   context.
 */
import {
  A2UI_OPERATIONS_KEY,
  createSurface,
  updateComponents,
  updateDataModel,
} from "@ag-ui/a2ui-toolkit";
import { generateText, jsonSchema, tool } from "ai";
import { z } from "zod";
import type { AgentModel } from "./model";
import flightSchema from "./a2ui/schemas/flight_schema.json";

/** The catalog the page registers (src/app/declarative-generative-ui/). */
export const APP_CATALOG_ID = "copilotkit://app-dashboard-catalog";

const FLIGHT_SURFACE_ID = "flight-search-results";

const flightInput = z.object({
  id: z.string(),
  airline: z.string(),
  airlineLogo: z.string(),
  flightNumber: z.string(),
  origin: z.string(),
  destination: z.string(),
  date: z.string(),
  departureTime: z.string(),
  arrivalTime: z.string(),
  duration: z.string(),
  status: z.string(),
  statusIcon: z.string(),
  price: z.string(),
});

/** `search_flights`: two flight cards on the pre-built flight surface. */
export const searchFlights = tool({
  description:
    "Show exactly two flight results as rich cards. Include every requested flight field.",
  inputSchema: z.object({ flights: z.array(flightInput).length(2) }),
  execute: async ({ flights }) => ({
    [A2UI_OPERATIONS_KEY]: [
      createSurface(FLIGHT_SURFACE_ID, APP_CATALOG_ID),
      updateComponents(
        FLIGHT_SURFACE_ID,
        flightSchema as Array<Record<string, unknown>>,
      ),
      updateDataModel(FLIGHT_SURFACE_ID, { flights }),
    ],
  }),
});

/** The components the dashboard catalog renders. */
export const DYNAMIC_A2UI_COMPONENT_NAMES = [
  "Title",
  "Row",
  "Column",
  "DashboardCard",
  "Metric",
  "PieChart",
  "BarChart",
  "Badge",
  "DataTable",
  "Button",
] as const;

export const DYNAMIC_A2UI_SYSTEM_PROMPT =
  "Design an A2UI dashboard. Use a flat component array with exactly one root " +
  "whose id is 'root'. Every component must include a non-empty id and " +
  `a component name. Available components: ${DYNAMIC_A2UI_COMPONENT_NAMES.join(
    ", ",
  )}.`;

const RENDER_A2UI_TOOL = "render_a2ui";

/** The arguments the dashboard model must return, as JSON Schema. */
const renderA2uiParameters = jsonSchema<unknown>({
  type: "object",
  properties: {
    surfaceId: { type: "string", minLength: 1 },
    components: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          id: { type: "string", minLength: 1 },
          component: {
            type: "string",
            enum: [...DYNAMIC_A2UI_COMPONENT_NAMES],
          },
        },
        required: ["id", "component"],
        additionalProperties: true,
      },
    },
    data: { type: "object", additionalProperties: true },
  },
  required: ["surfaceId", "components"],
});

/** The same arguments, checked before they reach the page. */
const renderA2uiArgs = z
  .object({
    surfaceId: z.string().min(1),
    components: z
      .array(
        z
          .object({
            id: z.string().min(1),
            component: z.enum(DYNAMIC_A2UI_COMPONENT_NAMES),
          })
          .passthrough(),
      )
      .min(1),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine(({ components }, context) => {
    if (components.filter(({ id }) => id === "root").length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["components"],
        message: 'must contain exactly one component with id "root"',
      });
    }
  });

/** Parses the dashboard model's arguments, or throws naming what is wrong. */
export function parseRenderA2uiArguments(input: unknown) {
  const result = renderA2uiArgs.safeParse(input);
  if (!result.success) {
    const detail = result.error.issues
      .map(
        (issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`,
      )
      .join("; ");
    throw new Error(`Invalid A2UI dashboard: ${detail}`);
  }
  return result.data;
}

/** One entry of the run's context (`useAgentContext`, the runtime's A2UI catalog). */
interface ContextEntry {
  description: string;
  value: string;
}

/**
 * `generate_a2ui`: a second model call designs the dashboard surface. It gets
 * the A2UI entries of the run's context, which CopilotKit's runtime fills with
 * the page's catalog (component names and their props) and the A2UI
 * generation guidelines.
 */
export function generateA2ui(
  agentModel: () => AgentModel,
  context: readonly ContextEntry[],
) {
  const a2uiContext = context
    .filter(({ description }) => description.startsWith("A2UI"))
    .map(({ value }) => value);

  return tool({
    description:
      "Design and render a dashboard with A2UI components for the user's request.",
    inputSchema: z.object({ user_intent: z.string() }),
    execute: async ({ user_intent }, { abortSignal }) => {
      const { model, providerOptions } = agentModel();
      const { toolCalls } = await generateText({
        model,
        instructions: [DYNAMIC_A2UI_SYSTEM_PROMPT, ...a2uiContext].join("\n\n"),
        prompt: user_intent,
        tools: {
          [RENDER_A2UI_TOOL]: tool({
            description: "Return the dashboard surface definition.",
            inputSchema: renderA2uiParameters,
          }),
        },
        toolChoice: { type: "tool", toolName: RENDER_A2UI_TOOL },
        providerOptions,
        abortSignal,
      });
      const call = toolCalls.find(
        ({ toolName }) => toolName === RENDER_A2UI_TOOL,
      );
      if (!call)
        throw new Error("The UI model did not return an A2UI surface.");

      const args = parseRenderA2uiArguments(call.input);
      const operations = [
        createSurface(args.surfaceId, APP_CATALOG_ID),
        updateComponents(args.surfaceId, args.components),
      ];
      if (args.data) {
        operations.push(updateDataModel(args.surfaceId, args.data));
      }
      return { [A2UI_OPERATIONS_KEY]: operations };
    },
  });
}
