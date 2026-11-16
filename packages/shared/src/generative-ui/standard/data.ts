import { z } from "zod";
import { chartSchema } from "./chart";
import { CHILDREN_SLOT, sizeValue, weightProp } from "./layout";
import { mapSchema } from "./map";

// ---- Schemas ----

const cellAlign = z.enum(["start", "center", "end"]).optional();

/**
 * A table cell or column header that shows another component. `id` is an
 * alias of `componentId`.
 */
const tableComponentCell = z.union([
  z.object({ componentId: z.string() }),
  z.object({ id: z.string() }),
]);

const tableColumn = z.union([
  z.string(),
  z.object({
    label: z.string(),
    align: cellAlign,
    width: sizeValue.optional(),
    componentId: z.string().optional(),
  }),
  tableComponentCell,
]);
export type TableColumn = z.output<typeof tableColumn>;

export const tableSchema = z.object({
  caption: z
    .string()
    .optional()
    .describe("A short name of the table for screen readers. It is not shown"),
  columns: z.array(tableColumn).optional().describe("Default []"),
  // A cell is `unknown`, so booleans and null from bound data are valid too.
  rows: z
    .array(z.array(z.unknown()))
    .optional()
    .describe(
      'A list of row lists. A cell is a string, a number, or { "componentId": "<id>" } to show a component. Default []',
    ),
  columnSizing: z.enum(["auto", "equal"]).optional().describe('Default "auto"'),
  dividers: z.boolean().optional().describe("Default true"),
  stickyHeader: z.boolean().optional().describe("Default false"),
  emptyLabel: z.string().optional().describe('Default "No rows"'),
});
export const tableSectionSchema = z.object({
  header: z.boolean().optional().describe("Renders the rows as the header"),
  rowDivider: z.boolean().optional(),
});
export const tableRowSchema = z.object({
  header: z.boolean().optional(),
  label: z
    .string()
    .optional()
    .describe("The text of a header cell at the start of the row"),
  labelColSpan: z.number().optional().describe("Columns the label cell spans"),
});
export const tableCellSchema = z.object({
  text: z.union([z.string(), z.number()]).optional(),
  header: z.boolean().optional(),
  align: cellAlign,
  vAlign: cellAlign.describe('Default "start"'),
  colSpan: z.number().optional(),
  rowSpan: z.number().optional(),
  width: sizeValue.optional(),
  padding: sizeValue.optional(),
});

const listItemValue = z.union([
  z.string(),
  z.object({
    label: z.string(),
    description: z.string().optional(),
    icon: z.string().optional().describe("Lucide icon name"),
    value: z
      .union([z.string(), z.number()])
      .optional()
      .describe(
        "Without an action: shown on the right of the label, for a key and value fact. With an action: the payload of the pick, not shown",
      ),
  }),
]);
export type ListItemValue = z.output<typeof listItemValue>;

export const LIST_MARKERS = ["bullet", "number", "rich", "none"] as const;
export type ListMarker = (typeof LIST_MARKERS)[number];

export const listSchema = z.object({
  items: z.array(listItemValue).optional(),
  direction: z
    .enum(["vertical", "horizontal"])
    .optional()
    .describe('Default "vertical". "horizontal" scrolls sideways'),
  align: z.enum(["start", "center", "end", "stretch"]).optional(),
  weight: weightProp,
  marker: z.enum(LIST_MARKERS).optional().describe('Default "bullet"'),
  connector: z.enum(["none", "solid"]).optional().describe('Default "none"'),
  gap: sizeValue.optional(),
  start: z.number().optional().describe('The first number of marker "number"'),
  maxMarkerSize: z
    .number()
    .optional()
    .describe("The width of the marker column in pixels"),
});
export const listItemSchema = z.object({
  label: z.string().optional(),
  value: z
    .union([z.string(), z.number()])
    .optional()
    .describe(
      "Without an action: shown on the right of the label, for a key and value fact",
    ),
  description: z.string().optional(),
  icon: z.string().optional().describe("Lucide icon name"),
  marker: z.string().optional().describe("Shows this text as the marker"),
  markerSize: z
    .number()
    .optional()
    .describe("The width of the marker column in pixels"),
  disabled: z
    .boolean()
    .optional()
    .describe("Greys the item out and ignores its action"),
});

export const listSelection = z.object({
  index: z.number(),
  label: z.string(),
  value: z.string().optional(),
});

export type ListSelection = z.output<typeof listSelection>;

/**
 * The standard data components, without their framework components:
 * tables, lists, a chart and a map. Each framework adds its components
 * with `withComponents`.
 *
 * - Table: `children` (TableSection or TableRow ids, or a template) and
 *   `cellComponents` (the components that `{ componentId }` cells show).
 * - List and ListItem: an `action` event. The List event gets the index,
 *   label and value of the picked item.
 * - Map: `selected` is writable, so a `{ "@path" }` binding gets the choice of
 *   the user.
 */
export const dataDeclarations = {
  Table: {
    description:
      'A data table, in a plain Column, not a Card. Give "columns" and "rows", or "children": TableSection or TableRow ids, or a template { "componentId", "path" } repeating a TableRow per item. A component in a cell or header (Badge, Button, Icon, Text): { "componentId": "<id>" }, with the id in "cellComponents".',
    props: tableSchema,
    slots: { children: "multiple", cellComponents: "multiple" } as const,
  },
  TableSection: {
    accessibility: "self" as const,
    description:
      "A group of TableRow children in a Table. With header true, it is the header of the table.",
    props: tableSectionSchema,
    slots: CHILDREN_SLOT,
  },
  TableRow: {
    accessibility: "self" as const,
    description:
      "A row of a Table. Its children are TableCell ids, or a template. With label, a header cell with that text starts the row.",
    props: tableRowSchema,
    slots: CHILDREN_SLOT,
  },
  TableCell: {
    accessibility: "self" as const,
    description:
      'A cell of a TableRow. It shows "text", or its children. With header true, it is a header cell.',
    props: tableCellSchema,
    slots: CHILDREN_SLOT,
  },
  List: {
    description:
      'A list in a Card or next to another component; a plain list of text is markdown. Give "items": an item with a value and no action is a key-value row (Price: $1,599). Or give "children": ListItem ids or a template. With "action" the user picks an item; the event context gets its index, label and value.',
    props: listSchema,
    events: {
      action: {
        description:
          "Runs when the user picks an item. The args are the index, label and value of the item.",
        parameters: listSelection,
      },
    },
    slots: CHILDREN_SLOT,
  },
  ListItem: {
    description:
      'An item of a List, with a label, a value on the right, a description, an icon and children. With an "action", the user can pick it.',
    props: listItemSchema,
    events: {
      action: {
        description: "Runs when the user picks the item.",
        parameters: z.object({}),
      },
    },
    slots: CHILDREN_SLOT,
  },
  Chart: {
    description:
      'A bar, line, area, scatter, pie or donut chart. "data" is a list of objects. "xKey" is the field of the category. "series" are the value fields.',
    props: chartSchema,
  },
  Map: {
    description:
      'A map with markers; with "route" a line connects them in order. Bind "selected" to get the label of the marker the user picks. Without maps it shows a list of the places.',
    props: mapSchema,
    writable: ["selected"] as const,
  },
};
