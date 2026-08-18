import { z } from "zod";

/**
 * Bellwether's a2ui catalog — the component vocabulary the Trading Review brief
 * is assembled from. It is the CONTRACT between the agent's tiny selection and
 * the deterministic op-builder (`build-brief-ops.ts`) that expands it.
 *
 * The cardinal rule lives in these descriptions: layout + label components may
 * carry text, but every FIGURE (order counts, value at risk, margins, prices) is
 * bound to live client data inside the renderers via `useReportData()`. The
 * agent never passes a number, so it can never fabricate one — see the
 * description prose on Heading/Text/StatCard/CategoryBreakdown/TradingList.
 */

export const CATALOG_ID = "https://cpk-a2ui.local/catalogs/commerce/v1";

// A single child id / a list of child ids. Layout components reference their
// children BY ID (the components list is flat, rooted at "root"); they never
// embed the child objects. `stringOrPath` is a2ui's "literal string OR a
// data-bound { path }" union — text props accept either, though Bellwether's
// builder only ever emits literals (all data binding happens in the renderers).
const childRef = z.string();
const childrenRef = z.array(z.string());
const stringOrPath = z.union([z.string(), z.object({ path: z.string() })]);

export const definitions = {
  Stack: {
    description:
      "Vertical layout. Children stack top→bottom. The default brief/section container.",
    props: z.object({
      children: childrenRef,
      gap: z.enum(["sm", "md", "lg", "xl"]).optional(),
    }),
  },
  Row: {
    description:
      "Horizontal layout; wraps on small screens. Use for metric rows or chip groups.",
    props: z.object({
      children: childrenRef,
      gap: z.enum(["sm", "md", "lg"]).optional(),
    }),
  },
  Grid: {
    description:
      "Responsive grid. Use for a row of StatCards (the KPI band across the top of the brief).",
    props: z.object({
      children: childrenRef,
      columns: z.number().int().min(1).max(4).optional(),
    }),
  },
  Section: {
    description:
      "Titled section grouping a region of the brief (e.g. 'Margin health').",
    props: z.object({ title: z.string(), child: childRef }),
  },
  Heading: {
    description:
      "The brief title — a LABEL ONLY. Use once at the top. Do NOT embed figures, " +
      "counts, prices, percentages, or trend claims (e.g. NOT 'Margin down 3pts') — " +
      "all quantitative content comes from StatCard/CategoryBreakdown/TradingList.",
    props: z.object({ text: stringOrPath }),
  },
  Text: {
    description:
      "A short NEUTRAL caption or section label (e.g. 'Ahead of Monday's trading review'). " +
      "Label-only: do NOT state figures, counts, prices, percentages, deltas, or trend " +
      "claims — every quantitative claim must come from StatCard/CategoryBreakdown/" +
      "TradingList, which bind live client data. Use tone='muted' for secondary captions.",
    props: z.object({
      text: stringOrPath,
      tone: z.enum(["default", "muted"]).optional(),
    }),
  },
  StatCard: {
    description:
      "A single KPI computed live on the client. `metric` selects which: 'ordersOnException' " +
      "(orders still stuck in the queue), 'valueAtRisk' (the total value of those orders), " +
      "'belowFloorSkus' (products whose margin sits under their category floor), " +
      "'medianMargin' (the range's median gross margin), 'pendingMarkdowns' (markdowns " +
      "waiting on a decision). Provide `label` for the caption. Do NOT pass the value.",
    props: z.object({
      metric: z.enum([
        "ordersOnException",
        "valueAtRisk",
        "belowFloorSkus",
        "medianMargin",
        "pendingMarkdowns",
      ]),
      label: stringOrPath,
    }),
  },
  CategoryBreakdown: {
    description:
      "The signature margin ladder: one rail per category, every product plotted at its " +
      "gross margin against that category's own floor, with anything under its floor drawn " +
      "in red beneath the line. Takes NO props — it renders the whole live range bound on " +
      "the client. Include it once when the brief is about margin, pricing or the range.",
    props: z.object({}),
  },
  TradingList: {
    description:
      "A live detail list. `kind` selects which: 'belowFloor' (each product trading under " +
      "its category floor, with the gap in margin points), 'exceptionOrders' (each order " +
      "still carrying an exception, with the customer, the exception and the value) or " +
      "'pendingMarkdowns' (each markdown awaiting a decision, with the margin it would " +
      "trade at). Rows are bound on the client — do NOT pass names, figures, or rows.",
    props: z.object({
      kind: z.enum(["belowFloor", "exceptionOrders", "pendingMarkdowns"]),
    }),
  },
};

export type Definitions = typeof definitions;
