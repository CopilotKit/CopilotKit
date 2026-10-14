import { z } from "zod";
import {
  ActionSchema,
  ChildListSchema,
  DynamicStringSchema,
} from "@a2ui/web_core/v0_9";
import type { CatalogDefinitions } from "../../../../create-catalog";
import { sizeValue } from "./layout";

/**
 * Children as static ids or a template `{ componentId, path }` that repeats
 * `componentId` once per element of the data-model array at `path`. Must be
 * built on `ChildListSchema` so the generic binder expands templates.
 */
const childList = ChildListSchema.optional().describe(
  'Child IDs, or a template { "componentId": "row", "path": "/rows" } repeated per array item',
);

const action = ActionSchema.optional().describe(
  'Dispatched on click. { "event": { "name": "...", "context": { ... } } }',
);

const cellAlign = z.enum(["start", "center", "end"]).optional();

export const tableColumn = z.union([
  z.string(),
  z.object({
    label: z.string(),
    align: cellAlign,
    width: sizeValue.optional(),
  }),
]);
export type TableColumn = z.infer<typeof tableColumn>;

export const listItemValue = z.union([
  z.string(),
  z.object({
    label: z.string(),
    description: z.string().optional(),
    icon: z.string().optional().describe("Lucide icon name"),
    action,
  }),
]);
export type ListItemValue = z.infer<typeof listItemValue>;

export const chartSeries = z.union([
  z.string(),
  z.object({
    key: z.string(),
    label: z.string().optional(),
    color: z.string().optional(),
  }),
]);
export type ChartSeries = z.infer<typeof chartSeries>;

export const mapMarker = z.object({
  label: z.string(),
  lat: z.number(),
  lng: z.number(),
  category: z.string().optional(),
  icon: z.string().optional(),
});
export type MapMarker = z.infer<typeof mapMarker>;

export const dataDefinitions = {
  Table: {
    description:
      "Data table. Either `columns` + `rows` (array of row arrays), or `children` of TableSection/TableRow (ids or a template).",
    props: z.object({
      columns: z
        .array(tableColumn)
        .optional()
        .describe('Strings or { "label", "align"?, "width"? }; default []'),
      rows: z
        .array(z.array(z.any()))
        .optional()
        .describe("Array of row arrays; default []"),
      children: childList,
      columnSizing: z
        .enum(["auto", "equal"])
        .optional()
        .describe('Default "auto"'),
      dividers: z.boolean().optional().describe("Default true"),
      stickyHeader: z.boolean().optional().describe("Default false"),
      emptyLabel: z.string().optional().describe('Default "No rows"'),
    }),
  },
  TableSection: {
    description: "Group of table rows; `header` renders it as <thead>.",
    props: z.object({
      header: z.boolean().optional(),
      rowDivider: z.boolean().optional(),
      children: childList,
    }),
  },
  TableRow: {
    description: "Table row; children are TableCell ids (or a template).",
    props: z.object({
      header: z.boolean().optional(),
      label: z.string().optional(),
      children: childList,
    }),
  },
  TableCell: {
    description: "Table cell with `text` or child ids.",
    props: z.object({
      text: DynamicStringSchema.optional().describe("Cell text"),
      header: z.boolean().optional(),
      align: cellAlign,
      vAlign: z
        .enum(["start", "center", "end"])
        .optional()
        .describe('Default "start"'),
      colSpan: z.number().optional(),
      rowSpan: z.number().optional(),
      width: sizeValue.optional(),
      padding: sizeValue.optional(),
      children: childList,
    }),
  },
  List: {
    description:
      "List of `items` (strings or { label, description?, icon?, action? }), or `children` ListItem ids/template when `items` is absent.",
    props: z.object({
      items: z.array(listItemValue).optional(),
      children: childList,
      marker: z
        .enum(["bullet", "number", "rich", "none"])
        .optional()
        .describe('Default "bullet"'),
      connector: z
        .enum(["none", "solid"])
        .optional()
        .describe('Default "none"'),
      gap: sizeValue.optional(),
      start: z.number().optional().describe("First number for marker=number"),
    }),
  },
  ListItem: {
    description:
      "List entry with label, description, icon and optional action.",
    props: z.object({
      label: DynamicStringSchema.optional().describe("Item label"),
      description: DynamicStringSchema.optional(),
      icon: z.string().optional().describe("Lucide icon name"),
      marker: z.string().optional().describe("Overrides the list marker"),
      action,
      children: childList,
    }),
  },
  Chart: {
    description:
      "Chart (recharts). `data` is an array of objects; `xKey` names the category field; `series` names the value fields.",
    props: z.object({
      chartType: z
        .enum(["bar", "line", "area", "scatter", "pie", "donut"])
        .optional()
        .describe('Default "bar"'),
      data: z.array(z.record(z.string(), z.any())).optional(),
      xKey: z.string().optional(),
      series: z
        .array(chartSeries)
        .optional()
        .describe('Strings or { "key", "label"?, "color"? }'),
      stacked: z.boolean().optional(),
      height: z.number().optional().describe("Pixels; default 240"),
      showLegend: z.boolean().optional().describe("Default true"),
      showGrid: z.boolean().optional().describe("Default true"),
      showTooltip: z.boolean().optional().describe("Default true"),
      showValueLabels: z.boolean().optional(),
      format: z.enum(["number", "currency", "percent"]).optional(),
      currency: z.string().optional().describe('ISO code; default "USD"'),
      title: z.string().optional(),
    }),
  },
  Map: {
    description:
      "Map (MapLibre) with markers; `route` connects markers in order. Falls back to a marker list when maps are unavailable.",
    props: z.object({
      markers: z.array(mapMarker).optional(),
      route: z.boolean().optional(),
      selected: DynamicStringSchema.optional().describe(
        'Selected marker label. Bind with { "path": "/x" }',
      ),
      height: z.number().optional().describe("Pixels; default 240"),
      zoom: z.number().optional(),
      center: z.object({ lat: z.number(), lng: z.number() }).optional(),
    }),
  },
} satisfies CatalogDefinitions;
