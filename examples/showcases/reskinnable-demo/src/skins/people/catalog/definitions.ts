import { z } from "zod";

/**
 * Rowan's a2ui catalog — the component vocabulary the People Review brief is
 * assembled from. It is the CONTRACT between the agent's tiny selection and the
 * deterministic op-builder (`build-brief-ops.ts`) that expands it.
 *
 * The cardinal rule lives in these descriptions: layout + label components may
 * carry text, but every FIGURE (headcount, out-of-band counts, salaries, band
 * positions) is bound to live client data inside the renderers via
 * `useReportData()`. The agent never passes a number, so it can never fabricate
 * one — see the description prose on Heading/Text/StatCard/LevelBreakdown/PeopleList.
 */

export const CATALOG_ID = "https://cpk-a2ui.local/catalogs/people/v1";

// A single child id / a list of child ids. Layout components reference their
// children BY ID (the components list is flat, rooted at "root"); they never
// embed the child objects. `stringOrPath` is a2ui's "literal string OR a
// data-bound { path }" union — text props accept either, though Rowan's builder
// only ever emits literals (all data binding happens in the renderers).
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
      "Titled section grouping a region of the brief (e.g. 'Compensation health').",
    props: z.object({ title: z.string(), child: childRef }),
  },
  Heading: {
    description:
      "The brief title — a LABEL ONLY. Use once at the top. Do NOT embed figures, " +
      "counts, salaries, percentages, or trend claims (e.g. NOT 'Headcount up 12%') — " +
      "all quantitative content comes from StatCard/LevelBreakdown/PeopleList.",
    props: z.object({ text: stringOrPath }),
  },
  Text: {
    description:
      "A short NEUTRAL caption or section label (e.g. 'Ahead of the leadership review'). " +
      "Label-only: do NOT state figures, counts, salaries, percentages, deltas, or trend " +
      "claims — every quantitative claim must come from StatCard/LevelBreakdown/PeopleList, " +
      "which bind live client data. Use tone='muted' for secondary captions.",
    props: z.object({
      text: stringOrPath,
      tone: z.enum(["default", "muted"]).optional(),
    }),
  },
  StatCard: {
    description:
      "A single KPI computed live on the client. `metric` selects which: 'headcount' " +
      "(people on the roster), 'outOfBandCount' (people whose salary sits outside their " +
      "level's band), 'openRequests' (pending items in the requests queue), " +
      "'medianBandPosition' (the roster's median position within band, 0%=band min, " +
      "100%=band max). Provide `label` for the caption. Do NOT pass the value.",
    props: z.object({
      metric: z.enum([
        "headcount",
        "outOfBandCount",
        "openRequests",
        "medianBandPosition",
      ]),
      label: stringOrPath,
    }),
  },
  LevelBreakdown: {
    description:
      "The signature compensation band-ladder: one rail per level (L3–L7), every person " +
      "plotted at their position within their own band, with anyone outside their band " +
      "drawn in red outside the rail. Takes NO props — it renders the whole live roster " +
      "bound on the client. Include it once when the brief is about comp or levelling.",
    props: z.object({}),
  },
  PeopleList: {
    description:
      "A live detail list. `kind` selects which: 'outOfBand' (each person whose salary " +
      "falls outside their band, with the side and figure) or 'openRequests' (each pending " +
      "item in the requests queue, with requester, kind, and value). Rows are bound on the " +
      "client — do NOT pass names, figures, or rows.",
    props: z.object({
      kind: z.enum(["outOfBand", "openRequests"]),
    }),
  },
};

export type Definitions = typeof definitions;
