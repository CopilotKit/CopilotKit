/**
 * The custom generative UI catalog: platform-agnostic component definitions.
 *
 * These are the components the agent is allowed to use. Each entry pairs a
 * Zod prop schema with a description. `index.ts` joins them with the React
 * renderers in renderers.tsx through `createGenerativeUI`. CopilotKit sends
 * the catalog with every run, and the runtime gives the v0.9 agents its
 * component schema as context.
 *
 * Prop types are plain: a prop the agent binds with `{ path }` arrives
 * resolved. `child()` / `childList()` mark the props that hold other
 * components; the renderer gets them as rendered React nodes.
 *
 * Catalog ID is constant and shared with the Python tools so createSurface
 * resolves to this catalog on the client.
 */
import { z } from "zod";
import { child, childList } from "@copilotkit/react-core/generative-ui";

export const CATALOG_ID = "https://cpk-a2ui.local/catalogs/copilotkit/v1";

export const definitions = {
  Stack: {
    description:
      "Vertical layout. Children stack top→bottom with consistent gap. Use as the default page/section container.",
    props: z.object({
      children: childList(),
      gap: z.enum(["xs", "sm", "md", "lg", "xl"]).optional(),
      align: z.enum(["start", "center", "end", "stretch"]).optional(),
    }),
  },

  Row: {
    description:
      "Horizontal layout. Children sit side-by-side; wraps on small screens. Use for toolbars, metric rows, badge groups.",
    props: z.object({
      children: childList(),
      gap: z.enum(["xs", "sm", "md", "lg"]).optional(),
      justify: z.enum(["start", "center", "end", "spaceBetween"]).optional(),
      align: z.enum(["start", "center", "end"]).optional(),
    }),
  },

  Grid: {
    description:
      "Responsive grid. Children fill columns left→right. Use for stat-card rows, chart pairs, card galleries.",
    props: z.object({
      children: childList(),
      columns: z.number().int().min(1).max(6).optional(),
      gap: z.enum(["xs", "sm", "md", "lg"]).optional(),
    }),
  },

  Section: {
    description:
      "Titled section with optional eyebrow + actions row. Use to group dashboard regions (e.g. 'Revenue', 'Top customers').",
    props: z.object({
      title: z.string(),
      eyebrow: z.string().optional(),
      child: child(),
    }),
  },

  Card: {
    description:
      "Bordered, rounded surface with padding. Pass a child layout (Stack/Row/Grid) as `child`.",
    props: z.object({
      child: child(),
      tone: z.enum(["default", "lilac", "mint", "warning"]).optional(),
    }),
  },

  Divider: {
    description: "A 1px line. No props.",
    props: z.object({}),
  },

  Heading: {
    description:
      "Page or section title. Use level 1 once per surface; 2 for major sections; 3 for sub-blocks.",
    props: z.object({
      text: z.string(),
      level: z.enum(["1", "2", "3"]).optional(),
    }),
  },

  Text: {
    description:
      "Body copy. Use tone='muted' for secondary text. Use size='sm' for captions.",
    props: z.object({
      text: z.string(),
      tone: z.enum(["default", "muted"]).optional(),
      size: z.enum(["sm", "md", "lg"]).optional(),
      weight: z.enum(["regular", "medium", "semibold"]).optional(),
    }),
  },

  Overline: {
    description:
      "Tiny ALL-CAPS mono label that sits above a heading. Common typography pattern (Material Design calls this 'Overline'). Use for section categories like 'OVERVIEW · Q1 2025'.",
    props: z.object({ text: z.string() }),
  },

  Badge: {
    description:
      "Small inline status pill. Use tone to imply meaning (positive=green, warning=amber, neutral=lilac).",
    props: z.object({
      label: z.string(),
      tone: z
        .enum(["neutral", "positive", "warning", "danger", "info"])
        .optional(),
    }),
  },

  Callout: {
    description:
      "Block-level highlight for a key insight, definition, or warning. Use for 'the takeaway' moments inside an explanation. Tone picks the accent color (info=lilac, positive=green, warning=amber, neutral=grey).",
    props: z.object({
      body: z.string(),
      title: z.string().optional(),
      tone: z.enum(["info", "positive", "warning", "neutral"]).optional(),
    }),
  },

  BulletList: {
    description:
      "Bulleted or numbered list. Use for short enumerations like 'three key contributions' or 'steps to reproduce'. Pass items as a literal string array or a {path} binding.",
    props: z.object({
      items: z.array(z.string()),
      ordered: z.boolean().optional(),
    }),
  },

  StatCard: {
    description:
      "Single big-number metric. Always include label + value. Use delta (e.g. '+12.4%') with deltaTone for trend.",
    props: z.object({
      label: z.string(),
      value: z.string(),
      delta: z.string().optional(),
      deltaTone: z.enum(["positive", "negative", "neutral"]).optional(),
      caption: z.string().optional(),
    }),
  },

  BarChart: {
    description:
      "Vertical bars. `data` must be an inline array of {label, value} objects (or a path that resolves to one). Use when labels are short (months, regions, < 7 chars). For long labels (customer names, country names), use HorizontalBarChart instead.",
    props: z.object({
      data: z.array(z.object({ label: z.string(), value: z.number() })),
      height: z.number().int().min(120).max(480).optional(),
    }),
  },

  HorizontalBarChart: {
    description:
      "Horizontal bars (rows). Same `data` shape as BarChart: [{label, value}]. Use for ranked lists where labels are long (e.g. 'Top 10 customers by ARR'). Height auto-sizes from row count.",
    props: z.object({
      data: z.array(z.object({ label: z.string(), value: z.number() })),
      height: z.number().int().min(120).max(640).optional(),
    }),
  },

  LineChart: {
    description:
      "Time-series line. `data` is [{label, value}, ...]. Use for trends where you want the direction of change to be the main signal.",
    props: z.object({
      data: z.array(z.object({ label: z.string(), value: z.number() })),
      height: z.number().int().min(120).max(480).optional(),
    }),
  },

  DonutChart: {
    description:
      "Donut / segment chart. `data` is [{label, value}, ...]. Use for share-of-total breakdowns with 3-6 slices.",
    props: z.object({
      data: z.array(z.object({ label: z.string(), value: z.number() })),
      height: z.number().int().min(120).max(480).optional(),
    }),
  },

  ScatterChart: {
    description:
      "X/Y scatter plot for correlation questions. `data` is [{x: number, y: number, label?: string}]. Use when the user asks 'is X correlated with Y' or 'plot A against B'. Provide xLabel and yLabel so the user knows what each axis represents.",
    props: z.object({
      data: z.array(
        z.object({
          x: z.number(),
          y: z.number(),
          label: z.string().optional(),
        }),
      ),
      xLabel: z.string().optional(),
      yLabel: z.string().optional(),
      height: z.number().int().min(160).max(560).optional(),
    }),
  },

  DataTable: {
    description:
      "Rows × columns table. `columns` is a list of {key, label}; `rows` is a list of records keyed by column key.",
    props: z.object({
      columns: z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          align: z.enum(["left", "right"]).optional(),
        }),
      ),
      rows: z.array(z.record(z.string(), z.union([z.string(), z.number()]))),
    }),
  },

  Button: {
    description:
      "Action button. Variant 'primary' is the main CTA (dark). 'secondary' is outlined. 'ghost' is borderless.",
    props: z.object({
      label: z.string(),
      variant: z.enum(["primary", "secondary", "ghost"]).optional(),
    }),
    // A v0.9 `action` on a Button arrives as `onClick`. Calling it sends the
    // action's event to the agent.
    events: {
      onClick: {
        description: "Sent to the agent when the user clicks the button.",
        parameters: z.object({}),
      },
    },
  },

  ChoiceChips: {
    description:
      "Horizontal pills bound to a data-model path. Use for scope filters " +
      "and quick switches. `options` is path-bindable so the agent can " +
      "populate the chips dynamically from data it just extracted. A click " +
      "sends the agent a `select_chip` action with the chip's value.",
    props: z.object({
      label: z.string(),
      options: z.array(z.object({ label: z.string(), value: z.string() })),
      /** The selected value (or values), usually bound with `{ path }`. */
      value: z.union([z.string(), z.array(z.string())]).optional(),
      multi: z.boolean().optional(),
    }),
    // Matches the `selectChip` function in index.ts, so it is always bound:
    // the agent does not set it. SurfaceCanvas handles the function.
    events: { onSelectChip: {} },
  },
};

export type Definitions = typeof definitions;
