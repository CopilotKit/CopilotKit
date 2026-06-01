import { z } from "zod";

type A2UIComponentDefinition = {
  description?: string;
  props: z.ZodObject<any>;
};

type A2UICatalogDefinitions = Record<string, A2UIComponentDefinition>;

export const CONTROL_ROOM_A2UI_CATALOG_ID =
  "copilotkit://ms-agent-harness-control-room";

export const metricSchema = z.object({
  label: z.string().describe("Short metric label."),
  value: z.string().describe("Metric value."),
  detail: z.string().optional().describe("Optional supporting text."),
});

export const categoryPointSchema = z.object({
  label: z.string().describe("Short category or x-axis label."),
  value: z.number().describe("Numeric value."),
});

export const areaPointSchema = z.object({
  label: z.string().describe("Short x-axis label."),
  primary: z.number().describe("Primary series value."),
  secondary: z
    .number()
    .optional()
    .describe("Optional comparison series value."),
});

export const tableRowSchema = z.object({
  label: z.string().describe("Row label."),
  status: z.string().optional().describe("Short status."),
  value: z.string().optional().describe("Primary row value."),
  detail: z.string().optional().describe("Optional supporting detail."),
});

export const fileSchema = z.object({
  path: z.string().describe("Workspace-relative file path."),
  status: z.string().optional().describe("Short status or risk label."),
  detail: z.string().optional().describe("Why this file matters."),
});

const componentBase = {
  title: z.string().optional().describe("Short component title."),
  description: z.string().optional().describe("One concise sentence."),
};

export const controlRoomA2UIDefinitions = {
  HarnessSummary: {
    description:
      "A concise status summary with labeled metrics. Use for mode, todos, files, tests, approvals, memory, or workspace orientation.",
    props: z.object({
      ...componentBase,
      metrics: z
        .array(metricSchema)
        .optional()
        .describe("Two to six labeled metrics."),
    }),
  },
  BarChart: {
    description:
      "A simple bar chart for comparing category values. Use when the user asks for a bar chart or a categorical comparison.",
    props: z.object({
      ...componentBase,
      data: z
        .array(categoryPointSchema)
        .optional()
        .describe("Two to eight category values."),
    }),
  },
  LineChart: {
    description:
      "A simple line chart for showing movement over an ordered sequence or timeline.",
    props: z.object({
      ...componentBase,
      data: z
        .array(categoryPointSchema)
        .optional()
        .describe("Two to eight ordered values."),
    }),
  },
  AreaChart: {
    description:
      "A filled area chart for showing a trend, with an optional comparison series.",
    props: z.object({
      ...componentBase,
      data: z
        .array(areaPointSchema)
        .optional()
        .describe("Two to eight ordered area chart points."),
    }),
  },
  DonutChart: {
    description:
      "A compact donut chart for showing proportional breakdowns by category.",
    props: z.object({
      ...componentBase,
      data: z
        .array(categoryPointSchema)
        .optional()
        .describe("Two to six proportional values."),
    }),
  },
  DataTable: {
    description:
      "A compact table for run health, checklist status, CSV summaries, or structured workspace facts.",
    props: z.object({
      ...componentBase,
      rows: z
        .array(tableRowSchema)
        .optional()
        .describe("Two to eight rows of structured status."),
    }),
  },
  FileList: {
    description:
      "A compact list of files with optional status and detail. Use after reading, listing, or comparing files.",
    props: z.object({
      ...componentBase,
      files: z
        .array(fileSchema)
        .optional()
        .describe("One to eight workspace-relative files."),
    }),
  },
} satisfies A2UICatalogDefinitions;

function unwrapOptional(schema: z.ZodTypeAny) {
  if (schema instanceof z.ZodOptional) {
    return { schema: schema.unwrap(), optional: true };
  }

  return { schema, optional: false };
}

function zodSchemaToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const description = schema.description
    ? { description: schema.description }
    : {};

  if (schema instanceof z.ZodString) {
    return { type: "string", ...description };
  }

  if (schema instanceof z.ZodNumber) {
    return { type: "number", ...description };
  }

  if (schema instanceof z.ZodArray) {
    return {
      type: "array",
      items: zodSchemaToJsonSchema(schema.element),
      ...description,
    };
  }

  if (schema instanceof z.ZodObject) {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(schema.shape)) {
      const { schema: innerSchema, optional } = unwrapOptional(
        value as z.ZodTypeAny,
      );
      properties[key] = zodSchemaToJsonSchema(innerSchema);
      if (!optional) {
        required.push(key);
      }
    }

    return {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
      ...description,
    };
  }

  return { type: "string", ...description };
}

export const controlRoomA2UISchema = {
  catalogId: CONTROL_ROOM_A2UI_CATALOG_ID,
  components: Object.fromEntries(
    Object.entries(controlRoomA2UIDefinitions).map(([name, definition]) => {
      const propsSchema = zodSchemaToJsonSchema(definition.props);
      const properties = {
        id: {
          type: "string",
          description: "Stable id for this A2UI node. Use root for the root.",
        },
        component: {
          const: name,
          description: `Render the local ${name} component.`,
        },
        ...((propsSchema.properties as Record<string, unknown> | undefined) ??
          {}),
      };

      return [
        name,
        {
          type: "object",
          description: definition.description,
          properties,
          required: ["id", "component"],
          additionalProperties: false,
        },
      ];
    }),
  ),
};
