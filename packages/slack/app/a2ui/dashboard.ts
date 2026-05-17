/**
 * Dashboard catalog — used by the *dynamic-schema* A2UI agent
 * (`packages/slack/agent/src/agents/a2ui_dynamic.py`).
 *
 * The dynamic agent doesn't ship a fixed component tree: a secondary
 * LLM generates one from the conversation, using whatever components
 * the catalog advertises. So the *quality* of the rendered Slack
 * surface depends entirely on (a) what components we expose here, and
 * (b) what we tell the agent about each in the schema context.
 *
 * We deliberately skip chart components (PieChart, BarChart): Slack
 * Block Kit has no native chart primitive and approximations look
 * worse than text. The agent is steered toward Metric / Badge /
 * DataTable / DashboardCard instead.
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
  Title: {
    description: "A heading. Use for section titles and page headers.",
    props: z.object({
      text: DynString,
      level: z.enum(["h1", "h2", "h3"]).optional(),
    }),
  },

  Text: {
    description: "Body text.",
    props: z.object({ text: DynString }),
  },

  Row: {
    description: "Horizontal layout container.",
    props: z.object({
      children: z.union([
        z.array(z.string()),
        z.object({ componentId: z.string(), path: z.string() }),
      ]),
      gap: z.number().optional(),
      align: z.string().optional(),
      justify: z.string().optional(),
    }),
  },

  Column: {
    description: "Vertical layout container.",
    props: z.object({
      children: z.union([
        z.array(z.string()),
        z.object({ componentId: z.string(), path: z.string() }),
      ]),
      gap: z.number().optional(),
    }),
  },

  DashboardCard: {
    description:
      "A card with a title (and optional subtitle) wrapping a single child component slot. Use to group a chart, metric, or other content under a label.",
    props: z.object({
      title: DynString,
      subtitle: DynString.optional(),
      child: z.string().optional(),
    }),
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

  Badge: {
    description:
      "A small colored status pill. Use for labels, statuses, categories.",
    props: z.object({
      text: DynString,
      variant: z
        .enum(["success", "warning", "error", "info", "neutral"])
        .optional(),
    }),
  },

  DataTable: {
    description:
      "Tabular data — columns array + rows array. Renders as a monospace-aligned text table in Slack (Block Kit has no native table).",
    props: z.object({
      columns: z.array(z.object({ key: z.string(), label: z.string() })),
      rows: z.array(z.record(z.any())),
    }),
  },

  Button: {
    description:
      "Interactive button. Renders a child component (typically a Text) as the label and fires `action.event` when clicked.",
    props: z.object({
      child: z.string().optional(),
      variant: z.enum(["primary", "secondary", "ghost"]).optional(),
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
    Title: ({ props }) => [
      {
        type: "header",
        text: { type: "plain_text", text: String(props.text), emoji: true },
      },
    ],

    Text: ({ props }) => [
      { type: "section", text: { type: "mrkdwn", text: String(props.text) } },
    ],

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

    DashboardCard: ({ props, children }) => {
      const header = [
        `*${String(props.title)}*`,
        props.subtitle ? `_${String(props.subtitle)}_` : "",
      ]
        .filter(Boolean)
        .join("\n");
      return [
        { type: "section", text: { type: "mrkdwn", text: header } },
        ...(props.child ? children(props.child) : []),
        { type: "divider" },
      ];
    },

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

    Badge: ({ props }) => {
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

    DataTable: ({ props }) => {
      const cols = (props.columns ?? []) as Array<{
        key: string;
        label: string;
      }>;
      const rows = (props.rows ?? []) as Array<Record<string, unknown>>;
      if (cols.length === 0 || rows.length === 0) return [];
      const widths = cols.map((c) =>
        Math.max(
          c.label.length,
          ...rows.map((r) => String(r[c.key] ?? "").length),
        ),
      );
      const fmt = (vals: string[]) =>
        vals.map((v, i) => v.padEnd(widths[i]!)).join("  ");
      const header = fmt(cols.map((c) => c.label));
      const sep = widths.map((w) => "─".repeat(w)).join("  ");
      const body = rows.map((r) =>
        fmt(cols.map((c) => String(r[c.key] ?? ""))),
      );
      const text = "```\n" + [header, sep, ...body].join("\n") + "\n```";
      return [{ type: "section", text: { type: "mrkdwn", text } }];
    },

    Button: ({ props, context, children, dispatch }) => {
      let label = "Submit";
      if (props.child) {
        const childBlocks = children(props.child);
        const firstSection = childBlocks.find(
          (b) => b.type === "section" && (b as any).text?.type === "mrkdwn",
        ) as { text: { text: string } } | undefined;
        if (firstSection) label = stripMrkdwn(firstSection.text.text);
      }
      // `props.action` after binder resolution is `() => void`; reach
      // into the raw component-model properties to get the encodable
      // `{ event: { name, context } }` shape.
      const rawAction = context.componentModel.properties["action"] as
        | { event: { name: string; context?: Record<string, unknown> } }
        | undefined;
      const elements: any[] = [
        {
          type: "button",
          text: { type: "plain_text", text: label, emoji: true },
          action_id: "a2ui:button",
          ...(rawAction && dispatch
            ? { value: dispatch.encodeAction(rawAction) }
            : {}),
          ...(props.variant === "primary" ? { style: "primary" as const } : {}),
        },
      ];
      return [{ type: "actions", elements }];
    },
  };

export const dashboardCatalog = createCatalog(
  dashboardDefinitions,
  dashboardRenderers,
  // catalogId must match CUSTOM_CATALOG_ID in
  // `packages/slack/agent/src/agents/a2ui_dynamic.py`.
  { catalogId: "declarative-gen-ui-catalog" },
);
