import { z } from "zod";

export const CATALOG_ID = "https://cpk-a2ui.local/catalogs/logistics/v1";

const childRef = z.string();
const childrenRef = z.array(z.string());
const stringOrPath = z.union([z.string(), z.object({ path: z.string() })]);

export const definitions = {
  Stack: {
    description:
      "Vertical layout. Children stack top→bottom. The default section container.",
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
      "Responsive grid. Use for a row of StatCards or a pair of charts.",
    props: z.object({
      children: childrenRef,
      columns: z.number().int().min(1).max(4).optional(),
    }),
  },
  Section: {
    description:
      "Titled section grouping a region of the brief (e.g. 'Network health').",
    props: z.object({ title: z.string(), child: childRef }),
  },
  Heading: {
    description:
      "The brief title — a LABEL ONLY. Use once at the top. Do NOT embed figures, " +
      "amounts, percentages, counts, or trend claims (e.g. NOT 'Exposure up 12%') — " +
      "all quantitative content comes from StatCard/Chart/ExceptionTable.",
    props: z.object({ text: stringOrPath }),
  },
  Text: {
    description:
      "A short NEUTRAL caption or section label (e.g. 'Network health', 'This week'). " +
      "Label-only: do NOT state figures, amounts, percentages, counts, deltas, or trend " +
      "claims — every quantitative claim must come from StatCard/Chart/ExceptionTable/" +
      "TradeoffTable, which bind live client data. Use tone='muted' for secondary captions.",
    props: z.object({
      text: stringOrPath,
      tone: z.enum(["default", "muted"]).optional(),
    }),
  },
  StatCard: {
    description:
      "A single KPI computed live on the client. `metric` selects which: 'onTimeRate' " +
      "(share of shipments arriving by their promised date), 'atRiskCount' (active " +
      "shipments at risk or delayed), 'exposureUsd' (value of active shipments that miss " +
      "their promised date), 'avgDelayDays' (mean slip against plan). Provide `label`.",
    props: z.object({
      metric: z.enum([
        "onTimeRate",
        "atRiskCount",
        "exposureUsd",
        "avgDelayDays",
      ]),
      label: stringOrPath,
    }),
  },
  Chart: {
    description:
      "A live network chart. `kind` selects which: 'lanePerformance' (on-time rate per " +
      "lane), 'exposureByLane' (at-risk value per lane), 'delayTrend' (slip over time), " +
      "'modeSplit' (shipment count by transport mode). Data is bound on the client — " +
      "do NOT pass numbers.",
    props: z.object({
      kind: z.enum([
        "lanePerformance",
        "exposureByLane",
        "delayTrend",
        "modeSplit",
      ]),
    }),
  },
  ExceptionTable: {
    description:
      "A live table of shipments. `status` filters which rows show: 'all', 'at_risk', " +
      "'delayed', or 'on_track' (defaults to 'all'). Data is bound on the client — " +
      "do NOT pass rows or figures.",
    props: z.object({
      status: z.enum(["all", "at_risk", "delayed", "on_track"]).optional(),
    }),
  },
  TradeoffTable: {
    description:
      "The live mitigation trade-off table for ONE shipment: cost, resulting ETA, whether " +
      "the promised date is met, and risk for each available option. Pass the shipment id " +
      "(e.g. 'shp-4821'); all figures are computed on the client.",
    props: z.object({ shipmentId: z.string() }),
  },
};

export type Definitions = typeof definitions;
