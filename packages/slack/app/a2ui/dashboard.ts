/**
 * Dashboard catalog — used by the *dynamic-schema* A2UI agent
 * (`packages/slack/agent/src/agents/a2ui_dynamic.py`).
 *
 * The dynamic agent doesn't ship a fixed component tree: a secondary
 * LLM generates one from the conversation, using whatever components
 * the catalog advertises. The agent's system prompt hard-codes
 * specific component names (Card / StatusBadge / Metric / InfoRow /
 * PrimaryButton / PieChart / BarChart) — this catalog matches that
 * exact set so the LLM doesn't generate names that fall out of
 * sanitization (which would surface as
 * `"LLM produced no valid root component"`).
 *
 * Charts (PieChart, BarChart) don't render natively in Slack; we
 * include them as text-shaped fallbacks so the LLM has somewhere
 * sensible to land when a chart is the obvious shape.
 *
 * `catalogId` matches `CUSTOM_CATALOG_ID` in
 * `agent/src/agents/a2ui_dynamic.py` — that's how the bridge routes
 * incoming `a2ui-surface` operations to this catalog.
 */
import { z } from "zod";
import {
  createCatalog,
  type CatalogDefinitions,
  type CatalogRenderers,
} from "../../src/index.js";

const DynString = z.union([z.string(), z.object({ path: z.string() })]);

export const dashboardDefinitions = {
  Row: {
    description: "Horizontal layout container; children render in a row.",
    props: z.object({
      children: z.array(z.string()),
      gap: z.number().optional(),
    }),
  },
  Column: {
    description: "Vertical layout container; children stack top-to-bottom.",
    props: z.object({
      children: z.array(z.string()),
      gap: z.number().optional(),
    }),
  },
  Card: {
    description:
      "Surface-style container with an optional title and a single child slot. Use to group a metric / chart / list under a label.",
    props: z.object({
      title: DynString.optional(),
      subtitle: DynString.optional(),
      child: z.string().optional(),
    }),
  },
  Title: {
    description: "Section header text.",
    props: z.object({ text: DynString }),
  },
  Text: {
    description: "Body text.",
    props: z.object({ text: DynString }),
  },
  Metric: {
    description:
      "A key metric — label + value + optional trend (up/down/neutral) with trendValue. Use for KPIs and stats.",
    props: z.object({
      label: DynString,
      value: DynString,
      trend: z.enum(["up", "down", "neutral"]).optional(),
      trendValue: DynString.optional(),
    }),
  },
  InfoRow: {
    description:
      "Label/value pair on a single line. Use for inline meta info like 'Owner: Atai' or 'Due: Friday'.",
    props: z.object({ label: DynString, value: DynString }),
  },
  StatusBadge: {
    description:
      "Colored status pill. Use for project/task status: success / warning / error / info / neutral.",
    props: z.object({
      text: DynString,
      variant: z
        .enum(["success", "warning", "error", "info", "neutral"])
        .optional(),
    }),
  },
  PrimaryButton: {
    description:
      "Primary action button. `child` is the id of the Text component supplying the label. `action.event.{name,context}` fires on click.",
    props: z.object({
      child: z.string().optional(),
      action: z
        .object({
          event: z.object({
            name: z.string(),
            context: z.record(z.any()).optional(),
          }),
        })
        .optional(),
    }),
  },
  // Charts: Slack Block Kit has no native chart primitive. We render
  // a text summary so the LLM has something coherent to land on, but
  // we steer the system prompt toward Metric/StatusBadge for the
  // typical dashboard shapes.
  PieChart: {
    description:
      "Pie/donut chart, used for part-of-whole breakdowns. Renders in Slack as a text summary of label:value pairs (Block Kit has no native chart primitive).",
    props: z.object({
      data: z.array(
        z.object({
          label: DynString,
          value: z.number(),
          color: z.string().optional(),
        }),
      ),
    }),
  },
  BarChart: {
    description:
      "Bar chart, used to compare values across categories. Renders in Slack as a text summary of label:value pairs.",
    props: z.object({
      data: z.array(
        z.object({ label: DynString, value: z.number() }),
      ),
      color: z.string().optional(),
    }),
  },
} satisfies CatalogDefinitions;

// ─── Renderers ──────────────────────────────────────────────────────

const variantEmoji: Record<string, string> = {
  success: ":large_green_circle:",
  warning: ":large_yellow_circle:",
  error: ":red_circle:",
  info: ":large_blue_circle:",
  neutral: ":white_circle:",
};

const trendArrow: Record<string, string> = {
  up: "↑",
  down: "↓",
  neutral: "→",
};

function flattenChildren(
  raw: unknown,
  children: (id: string, basePath?: string) => unknown[],
): unknown[] {
  const kids = raw as
    | string[]
    | Array<{ id: string; basePath?: string }>
    | undefined;
  return (kids ?? []).flatMap((c) =>
    typeof c === "string" ? children(c) : children(c.id, c.basePath),
  );
}

function stripMrkdwn(s: string): string {
  return s.replace(/\*([^*]+)\*/g, "$1").replace(/_([^_]+)_/g, "$1");
}

export const dashboardRenderers: CatalogRenderers<typeof dashboardDefinitions> =
  {
    Row: ({ props, children }) =>
      flattenChildren(
        props.children,
        children as (id: string, basePath?: string) => unknown[],
      ) as any,
    Column: ({ props, children }) =>
      flattenChildren(
        props.children,
        children as (id: string, basePath?: string) => unknown[],
      ) as any,
    Card: ({ props, children }) => {
      const headerLines = [
        props.title ? `*${String(props.title)}*` : null,
        props.subtitle ? `_${String(props.subtitle)}_` : null,
      ].filter(Boolean);
      const header = headerLines.length
        ? [
            {
              type: "section" as const,
              text: { type: "mrkdwn" as const, text: headerLines.join("\n") },
            },
          ]
        : [];
      const body = props.child ? children(props.child) : [];
      return [...header, ...body, { type: "divider" as const }];
    },
    Title: ({ props }) => [
      {
        type: "header",
        text: { type: "plain_text", text: String(props.text), emoji: true },
      },
    ],
    Text: ({ props }) => [
      { type: "section", text: { type: "mrkdwn", text: String(props.text) } },
    ],
    Metric: ({ props }) => {
      const trend =
        props.trend && props.trendValue
          ? ` ${trendArrow[props.trend] ?? ""} ${String(props.trendValue)}`
          : "";
      return [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${String(props.label)}*: ${String(props.value)}${trend}`,
          },
        },
      ];
    },
    InfoRow: ({ props }) => [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${String(props.label)}*: ${String(props.value)}`,
        },
      },
    ],
    StatusBadge: ({ props }) => {
      const emoji = variantEmoji[props.variant ?? "neutral"] ?? "";
      return [
        {
          type: "context",
          elements: [
            { type: "mrkdwn", text: `${emoji} ${String(props.text)}`.trim() },
          ],
        },
      ];
    },
    PrimaryButton: ({ props, context, children, dispatch }) => {
      let label = "Submit";
      if (props.child) {
        const childBlocks = children(props.child);
        const firstSection = childBlocks.find(
          (b) => b.type === "section" && (b as any).text?.type === "mrkdwn",
        ) as { text: { text: string } } | undefined;
        if (firstSection) label = stripMrkdwn(firstSection.text.text);
      }
      const rawAction = context.componentModel.properties["action"] as
        | { event: { name: string; context?: Record<string, unknown> } }
        | undefined;
      const elements: any[] = [
        {
          type: "button",
          text: { type: "plain_text", text: label, emoji: true },
          action_id: "a2ui:button",
          style: "primary" as const,
          ...(rawAction && dispatch
            ? { value: dispatch.encodeAction(rawAction) }
            : {}),
        },
      ];
      return [{ type: "actions", elements }];
    },
    PieChart: ({ props }) => {
      const data = (props.data ?? []) as Array<{
        label: string;
        value: number;
      }>;
      if (data.length === 0) return [];
      const total = data.reduce((sum, d) => sum + d.value, 0) || 1;
      const lines = data
        .map((d) => {
          const pct = ((d.value / total) * 100).toFixed(0);
          return `• *${String(d.label)}*: ${d.value} (${pct}%)`;
        })
        .join("\n");
      return [
        {
          type: "section",
          text: { type: "mrkdwn", text: ":pie:  *Breakdown*\n" + lines },
        },
      ];
    },
    BarChart: ({ props }) => {
      const data = (props.data ?? []) as Array<{
        label: string;
        value: number;
      }>;
      if (data.length === 0) return [];
      const max = Math.max(...data.map((d) => d.value), 1);
      // Render as ASCII bar chart in a code block — column-aligned and
      // readable in Slack.
      const maxLabelLen = Math.max(...data.map((d) => String(d.label).length));
      const lines = data
        .map((d) => {
          const barWidth = Math.round((d.value / max) * 20);
          const bar = "█".repeat(barWidth);
          return `${String(d.label).padEnd(maxLabelLen)}  ${bar.padEnd(20)}  ${d.value}`;
        })
        .join("\n");
      return [
        {
          type: "section",
          text: { type: "mrkdwn", text: "```\n" + lines + "\n```" },
        },
      ];
    },
  };

export const dashboardCatalog = createCatalog(
  dashboardDefinitions,
  dashboardRenderers,
  // catalogId must match CUSTOM_CATALOG_ID in
  // `packages/slack/agent/src/agents/a2ui_dynamic.py`.
  { catalogId: "declarative-gen-ui-catalog" },
);
