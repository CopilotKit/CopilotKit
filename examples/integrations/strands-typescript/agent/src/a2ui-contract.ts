import {
  createSurface,
  updateComponents,
  updateDataModel,
} from "@ag-ui/a2ui-toolkit";
import { z } from "zod";

export const APP_CATALOG_ID = "copilotkit://app-dashboard-catalog";

export const DYNAMIC_A2UI_COMPONENT_NAMES = [
  "Text",
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

const componentSchema = z
  .object({
    id: z.string().min(1),
    component: z.enum(DYNAMIC_A2UI_COMPONENT_NAMES),
  })
  .passthrough();

const renderA2uiArgsSchema = z
  .object({
    surfaceId: z.string().min(1),
    components: z.array(componentSchema).min(1),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine(({ components }, context) => {
    const rootCount = components.filter(({ id }) => id === "root").length;
    if (rootCount !== 1) {
      context.addIssue({
        code: "custom",
        path: ["components"],
        message: 'must contain exactly one component with id "root"',
      });
    }
  });

export type RenderA2uiArgs = z.infer<typeof renderA2uiArgsSchema>;

export const DYNAMIC_A2UI_SYSTEM_PROMPT =
  "Design an A2UI dashboard. Use a flat component array with exactly one root " +
  "whose id is 'root'. Every component must include a non-empty id and " +
  `a component name. Available components: ${DYNAMIC_A2UI_COMPONENT_NAMES.join(
    ", ",
  )}.`;

export const RENDER_A2UI_TOOL = {
  type: "function" as const,
  function: {
    name: "render_a2ui",
    description: "Return the dashboard surface definition.",
    parameters: {
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
    },
  },
};

export function parseRenderA2uiArguments(raw: string): RenderA2uiArgs {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "Invalid A2UI generation contract: arguments are not JSON.",
    );
  }

  const result = renderA2uiArgsSchema.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues
      .map(
        (issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`,
      )
      .join("; ");
    throw new Error(`Invalid A2UI generation contract: ${detail}`);
  }
  return result.data;
}

export function buildA2uiOperations(args: RenderA2uiArgs) {
  const operations = [
    createSurface(args.surfaceId, APP_CATALOG_ID),
    updateComponents(args.surfaceId, args.components),
  ];
  if (args.data) operations.push(updateDataModel(args.surfaceId, args.data));
  return operations;
}
