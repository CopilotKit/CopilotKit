import { z } from "zod";
import type { CatalogDefinitions } from "@copilotkit/a2ui-renderer";

export const CONTROL_ROOM_A2UI_CATALOG_ID =
  "copilotkit://ms-agent-harness-control-room";

const childIdsSchema = z
  .array(z.string())
  .describe("Child component ids rendered inside this component.");

export const metricSchema = z.object({
  label: z.string().describe("Short metric label."),
  value: z.string().describe("Metric value to display."),
  detail: z.string().optional().describe("Optional supporting text."),
  trend: z.enum(["up", "down", "neutral"]).optional(),
  tone: z.enum(["default", "success", "warning", "danger"]).optional(),
});

export const chartPointSchema = z.object({
  label: z.string().describe("Short category or x-axis label."),
  value: z.number().describe("Primary numeric value."),
  secondary: z.number().optional().describe("Optional comparison value."),
});

const stackedAreaPointSchema = z.object({
  label: z.string().describe("Short x-axis label."),
  toolCalls: z.number().describe("Tool-call activity value."),
  evidence: z.number().describe("Evidence or file-read activity value."),
  approvals: z.number().describe("Approval activity value."),
});

const donutPointSchema = z.object({
  name: z.string().describe("Slice label."),
  value: z.number().describe("Slice value."),
});

const radarPointSchema = z.object({
  capability: z.string().describe("Capability label."),
  score: z.number().describe("Score from 0 to 100."),
});

const radialMetricSchema = z.object({
  label: z.string().describe("Short progress label."),
  value: z.number().describe("Progress value from 0 to 100."),
  detail: z.string().optional().describe("Optional supporting text."),
});

const optionSchema = z.object({
  label: z.string(),
  value: z.string(),
});

const tableRowSchema = z.object({
  check: z.string().describe("Check name."),
  status: z.enum(["pass", "running", "blocked", "fail"]).describe("Status."),
  progress: z.number().describe("Progress percentage from 0 to 100."),
  detail: z.string().describe("Short detail."),
});

const fileImpactSchema = z.object({
  path: z.string().describe("File path shown to the operator."),
  risk: z.enum(["low", "medium", "high"]).describe("Risk level."),
  change: z.string().describe("Short change or inspection summary."),
});

const timelineEventSchema = z.object({
  label: z.string().describe("Short event label."),
  date: z.string().describe("ISO date such as 2026-06-03."),
  detail: z.string().optional().describe("Optional short detail."),
  tone: z.enum(["default", "success", "warning", "danger"]).optional(),
});

const approvalCheckSchema = z.object({
  label: z.string().describe("Short readiness check."),
  complete: z.boolean().describe("Whether the check is complete."),
});

export const controlRoomA2UIDefinitions = {
  Surface: {
    description:
      "Top-level composed A2UI surface. Use this as the root for dashboards, reports, forms, and multi-card layouts.",
    props: z.object({
      title: z.string(),
      subtitle: z.string().optional(),
      eyebrow: z.string().optional(),
      children: childIdsSchema.optional(),
    }),
  },
  SectionHeader: {
    description:
      "Header block for a surface section, with optional description and badge text.",
    props: z.object({
      title: z.string(),
      description: z.string().optional(),
      badge: z.string().optional(),
    }),
  },
  Card: {
    description:
      "ShadCN card container with a title, optional description and badge, and child components.",
    props: z.object({
      title: z.string().optional(),
      description: z.string().optional(),
      badge: z.string().optional(),
      children: childIdsSchema.optional(),
    }),
  },
  Metric: {
    description:
      "Key/value KPI display for dashboards. Put several Metrics inside a Row or Card.",
    props: metricSchema,
  },
  Badge: {
    description:
      "Small colored status badge. Use for state, severity, category, or compact labels.",
    props: z.object({
      text: z.string(),
      variant: z
        .enum(["default", "secondary", "success", "warning", "danger", "info"])
        .optional(),
    }),
  },
  Button: {
    description:
      "ShadCN button. Attach an optional action payload that dispatches back to the agent when clicked.",
    props: z.object({
      label: z.string(),
      variant: z.enum(["default", "secondary", "outline", "ghost"]).optional(),
      action: z.any().optional(),
    }),
  },
  TextInput: {
    description: "ShadCN text input with an optional label and placeholder.",
    props: z.object({
      label: z.string().optional(),
      value: z.string().optional(),
      placeholder: z.string().optional(),
    }),
  },
  Textarea: {
    description: "ShadCN textarea with an optional label and placeholder.",
    props: z.object({
      label: z.string().optional(),
      value: z.string().optional(),
      placeholder: z.string().optional(),
    }),
  },
  Select: {
    description: "ShadCN select/drop-down with label, value, and options.",
    props: z.object({
      label: z.string().optional(),
      value: z.string().optional(),
      placeholder: z.string().optional(),
      options: z.array(optionSchema).min(1),
    }),
  },
  Checkbox: {
    description: "ShadCN checkbox row for binary states.",
    props: z.object({
      label: z.string(),
      checked: z.boolean().optional(),
    }),
  },
  Switch: {
    description: "ShadCN switch row for binary states.",
    props: z.object({
      label: z.string(),
      checked: z.boolean().optional(),
    }),
  },
  Progress: {
    description: "ShadCN progress bar with a label and percent value.",
    props: z.object({
      label: z.string(),
      value: z.number(),
      detail: z.string().optional(),
    }),
  },
  BarChart: {
    description:
      "Bar chart for category comparisons. Compose inside Card for dashboard panels.",
    props: z.object({
      title: z.string().optional(),
      summary: z.string().optional(),
      data: z.array(chartPointSchema).min(2).max(8),
    }),
  },
  LineChart: {
    description:
      "Line chart for movement across a sequence or timeline. Compose inside Card for dashboard panels.",
    props: z.object({
      title: z.string().optional(),
      summary: z.string().optional(),
      data: z.array(chartPointSchema).min(2).max(8),
    }),
  },
  AreaChart: {
    description:
      "Area chart for progress over time with an optional comparison series.",
    props: z.object({
      title: z.string().optional(),
      summary: z.string().optional(),
      data: z.array(chartPointSchema).min(2).max(8),
    }),
  },
  StackedAreaChart: {
    description:
      "Stacked area chart for tool calls, evidence, and approvals over time.",
    props: z.object({
      title: z.string().optional(),
      summary: z.string().optional(),
      data: z.array(stackedAreaPointSchema).min(2).max(8),
    }),
  },
  DonutChart: {
    description:
      "Donut chart for compact part-of-whole breakdowns such as tool usage.",
    props: z.object({
      title: z.string().optional(),
      summary: z.string().optional(),
      data: z.array(donutPointSchema).min(2).max(8),
    }),
  },
  RadarChart: {
    description:
      "Radar chart for comparing capability scores across dimensions.",
    props: z.object({
      title: z.string().optional(),
      summary: z.string().optional(),
      data: z.array(radarPointSchema).min(3).max(8),
    }),
  },
  RadialChart: {
    description:
      "Radial progress chart for one to four readiness or verification metrics.",
    props: z.object({
      title: z.string().optional(),
      summary: z.string().optional(),
      metrics: z.array(radialMetricSchema).min(1).max(4),
    }),
  },
  Calendar: {
    description:
      "Calendar panel with dated milestones or approval windows from the generative UI sidebar.",
    props: z.object({
      title: z.string(),
      summary: z.string().optional(),
      events: z.array(timelineEventSchema).min(1).max(8),
    }),
  },
  RunHealthTable: {
    description:
      "Table for tests, coverage, approvals, memory, and run health checks.",
    props: z.object({
      title: z.string().optional(),
      summary: z.string().optional(),
      rows: z.array(tableRowSchema).min(2).max(8),
    }),
  },
  FileImpactMap: {
    description:
      "File impact list from the generative UI sidebar, showing file paths, risk, and changes.",
    props: z.object({
      title: z.string().optional(),
      summary: z.string().optional(),
      files: z.array(fileImpactSchema).min(1).max(6),
    }),
  },
  ApprovalForm: {
    description:
      "Display-only approval readiness form composed from ShadCN inputs, badges, and checkboxes.",
    props: z.object({
      title: z.string(),
      summary: z.string().optional(),
      command: z.string(),
      risk: z.enum(["low", "medium", "high"]),
      checks: z.array(approvalCheckSchema).min(2).max(5),
    }),
  },
  HandoffForm: {
    description:
      "Display-only handoff form with owner, notes, and follow-up checklist.",
    props: z.object({
      title: z.string(),
      summary: z.string().optional(),
      owner: z.string(),
      notes: z.string(),
      followups: z.array(z.string()).min(1).max(4),
    }),
  },
} satisfies CatalogDefinitions;

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

  if (schema instanceof z.ZodBoolean) {
    return { type: "boolean", ...description };
  }

  if (schema instanceof z.ZodEnum) {
    return { type: "string", enum: schema.options, ...description };
  }

  if (schema instanceof z.ZodAny) {
    return { ...description };
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
