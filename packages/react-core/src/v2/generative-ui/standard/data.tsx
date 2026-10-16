import React, { createContext, isValidElement, useContext } from "react";
import type { CSSProperties, ReactNode } from "react";
import { z } from "zod";
import { CHILDREN_SLOT, sizeValue } from "./layout";
import { LucideIcon } from "./media";
import { Chart, VISUALLY_HIDDEN, chartSchema } from "./Chart";
import { MapView, mapSchema } from "./Map";
import {
  FONT_WEIGHT,
  backgroundColor,
  borderColor,
  radius,
  spacing,
  textColor,
  textFont,
} from "./tokens";
import { useStandardStyles } from "./styles";

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
type TableColumn = z.output<typeof tableColumn>;

const tableSchema = z.object({
  caption: z
    .string()
    .optional()
    .describe("A short name of the table for screen readers. It is not shown"),
  columns: z
    .array(tableColumn)
    .optional()
    .describe(
      'Strings, { "label", "align"?, "width"?, "componentId"? } or { "componentId" }, or { "path": "/x" }. Default []',
    ),
  // A cell is `unknown`, so booleans and null from bound data are valid too.
  rows: z
    .array(z.array(z.unknown()))
    .optional()
    .describe(
      'A list of row lists, or { "path": "/x" }. A cell is a string, a number, or { "componentId": "<id>" } to show a component. Default []',
    ),
  columnSizing: z.enum(["auto", "equal"]).optional().describe('Default "auto"'),
  dividers: z.boolean().optional().describe("Default true"),
  stickyHeader: z.boolean().optional().describe("Default false"),
  emptyLabel: z.string().optional().describe('Default "No rows"'),
});
const tableSectionSchema = z.object({
  header: z.boolean().optional().describe("Renders the rows as the header"),
  rowDivider: z.boolean().optional(),
});
const tableRowSchema = z.object({
  header: z.boolean().optional(),
  label: z
    .string()
    .optional()
    .describe("The text of a header cell at the start of the row"),
  labelColSpan: z.number().optional().describe("Columns the label cell spans"),
});
const tableCellSchema = z.object({
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
type ListItemValue = z.output<typeof listItemValue>;

const LIST_MARKERS = ["bullet", "number", "rich", "none"] as const;
type ListMarker = (typeof LIST_MARKERS)[number];

const listSchema = z.object({
  items: z
    .array(listItemValue)
    .optional()
    .describe(
      'Strings or { "label", "value"?, "description"?, "icon"? }, or { "path": "/x" }',
    ),
  marker: z.enum(LIST_MARKERS).optional().describe('Default "bullet"'),
  connector: z.enum(["none", "solid"]).optional().describe('Default "none"'),
  gap: sizeValue.optional(),
  start: z.number().optional().describe('The first number of marker "number"'),
  maxMarkerSize: z
    .number()
    .optional()
    .describe("The width of the marker column in pixels"),
});
const listItemSchema = z.object({
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

const listSelection = z.object({
  index: z.number(),
  label: z.string(),
  value: z.string().optional(),
});

type ListSelection = z.output<typeof listSelection>;

type EventProp<Args> = (args: Args) => Promise<unknown>;

type TableProps = z.output<typeof tableSchema> & {
  children?: ReactNode;
  cellComponents?: ReactNode;
};
type TableSectionProps = z.output<typeof tableSectionSchema> & {
  children?: ReactNode;
};
type TableRowProps = z.output<typeof tableRowSchema> & {
  children?: ReactNode;
};
type TableCellProps = z.output<typeof tableCellSchema> & {
  children?: ReactNode;
};
type ListProps = z.output<typeof listSchema> & {
  children?: ReactNode;
  action?: EventProp<ListSelection>;
};
type ListItemProps = z.output<typeof listItemSchema> & {
  children?: ReactNode;
  action?: EventProp<Record<string, never>>;
};

// ---- Table ----

interface TableContextValue {
  dividers: boolean;
  /** True inside a TableSection. Rows there render a bare `<tr>`. */
  isInSection: boolean;
  /** True inside a header section or row. Cells there render `<th>`. */
  isHeader: boolean;
}

const TableContext = createContext<TableContextValue | null>(null);

const V_ALIGN = { start: "top", center: "middle", end: "bottom" } as const;

/**
 * The attributes of a cell: 14px text, 8px padding (none at the outer
 * edges), medium weight for headers, hairline row dividers. The padding,
 * edges and dividers come from the `.a2ui-std-cell` rules, so a `padding`
 * prop still wins.
 */
function cellAttributes(options: {
  isHeader: boolean;
  hasDivider: boolean;
  align?: "start" | "center" | "end";
  vAlign?: "start" | "center" | "end";
  width?: number | string;
  padding?: number | string;
}) {
  return {
    className: "a2ui-std-cell",
    "data-divider": options.hasDivider ? "" : undefined,
    style: {
      ...textFont("sm"),
      textAlign: options.align ?? "start",
      verticalAlign: V_ALIGN[options.vAlign ?? "start"],
      padding: spacing(options.padding),
      width: spacing(options.width),
      fontWeight: options.isHeader ? FONT_WEIGHT.medium : undefined,
      color: textColor("default"),
    } satisfies CSSProperties,
  };
}

/** The component id of a `{ componentId }` or `{ id }` cell, else `undefined`. */
function cellComponentId(value: unknown) {
  const isObject =
    typeof value === "object" && value !== null && !Array.isArray(value);
  if (!isObject) return undefined;
  if ("componentId" in value && typeof value.componentId === "string") {
    return value.componentId || undefined;
  }
  if ("id" in value && typeof value.id === "string") {
    return value.id || undefined;
  }
  return undefined;
}

function cellText(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * The rendered components of a "multiple" slot by component id. The engine
 * renders a list of ids as one element for each id, keyed by that id.
 */
function elementsById(slot: ReactNode) {
  const byId = new Map<string, ReactNode>();
  const elements = Array.isArray(slot) ? slot : [];
  for (const element of elements) {
    if (isValidElement(element) && typeof element.key === "string") {
      byId.set(element.key, element);
    }
  }
  return byId;
}

/** A component for a `{ componentId }` cell, else the cell value as text. */
function cellContent(value: unknown, components: Map<string, ReactNode>) {
  const id = cellComponentId(value);
  if (id === undefined) return cellText(value);
  return components.get(id) ?? null;
}

interface NormalizedColumn {
  label?: string;
  align?: "start" | "center" | "end";
  width?: number | string;
  componentId?: string;
}

function normalizeColumn(column: TableColumn): NormalizedColumn {
  if (typeof column === "string") return { label: column };
  const componentId = cellComponentId(column);
  return "label" in column ? { ...column, componentId } : { componentId };
}

function Caption({ text }: { text: string | undefined }) {
  if (!text) return null;
  return <caption style={VISUALLY_HIDDEN}>{text}</caption>;
}

function Table(props: TableProps) {
  useStandardStyles();
  const dividers = props.dividers ?? true;
  const columns = (props.columns ?? []).map(normalizeColumn);
  const rows = props.rows ?? [];
  const components = elementsById(props.cellComponents);
  const tableStyle: CSSProperties = {
    width: "100%",
    borderCollapse: "collapse",
    tableLayout: props.columnSizing === "equal" ? "fixed" : "auto",
  };
  const wrapperStyle: CSSProperties = {
    maxHeight: props.stickyHeader ? 480 : undefined,
    overflowY: props.stickyHeader ? "auto" : undefined,
  };
  const isChildrenMode =
    props.children !== undefined && rows.length === 0 && columns.length === 0;

  if (isChildrenMode) {
    return (
      <div
        className="a2ui-std-table-wrap"
        data-a2ui-std=""
        style={wrapperStyle}
      >
        <TableContext.Provider
          value={{ dividers, isInSection: false, isHeader: false }}
        >
          <table className="a2ui-std-table" style={tableStyle}>
            <Caption text={props.caption} />
            {props.children}
          </table>
        </TableContext.Provider>
      </div>
    );
  }

  const rowLengths = rows.map((row) => row.length);
  const columnCount = Math.max(columns.length, ...rowLengths, 1);
  const stickyStyle: CSSProperties = props.stickyHeader
    ? { position: "sticky", top: 0, background: backgroundColor("surface") }
    : {};

  return (
    <div className="a2ui-std-table-wrap" data-a2ui-std="" style={wrapperStyle}>
      <table className="a2ui-std-table" style={tableStyle}>
        <Caption text={props.caption} />
        {columns.length > 0 ? (
          <thead>
            <tr>
              {columns.map((column, index) => {
                const cell = cellAttributes({
                  isHeader: true,
                  hasDivider: true,
                  align: column.align,
                  width: column.width,
                });
                return (
                  <th
                    key={`${column.label ?? column.componentId}-${index}`}
                    scope="col"
                    {...cell}
                    style={{ ...cell.style, ...stickyStyle }}
                  >
                    {column.label}
                    {column.componentId
                      ? components.get(column.componentId)
                      : null}
                  </th>
                );
              })}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columnCount}
                className="a2ui-std-cell"
                style={{
                  ...cellAttributes({ isHeader: false, hasDivider: false })
                    .style,
                  color: textColor("tertiary"),
                  textAlign: "center",
                }}
              >
                {props.emptyLabel ?? "No rows"}
              </td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((value, columnIndex) => (
                  <td
                    key={columnIndex}
                    {...cellAttributes({
                      isHeader: false,
                      hasDivider: dividers && rowIndex < rows.length - 1,
                      align: columns[columnIndex]?.align,
                    })}
                  >
                    {cellContent(value, components)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function TableSection(props: TableSectionProps) {
  const parent = useContext(TableContext);
  const isHeader = props.header === true;
  const Tag = isHeader ? "thead" : "tbody";
  return (
    <TableContext.Provider
      value={{
        dividers: props.rowDivider ?? parent?.dividers ?? true,
        isInSection: true,
        isHeader,
      }}
    >
      <Tag>{props.children}</Tag>
    </TableContext.Provider>
  );
}

function TableRow(props: TableRowProps) {
  const parent = useContext(TableContext);
  const isHeader = props.header === true || parent?.isHeader === true;
  const dividers = parent?.dividers ?? true;
  const row = (
    <TableContext.Provider
      value={{
        dividers,
        isInSection: true,
        isHeader,
      }}
    >
      <tr>
        {props.label ? (
          <th
            scope="row"
            colSpan={props.labelColSpan}
            {...cellAttributes({
              isHeader: true,
              hasDivider: dividers,
              align: "start",
            })}
          >
            {props.label}
          </th>
        ) : null}
        {props.children}
      </tr>
    </TableContext.Provider>
  );
  // A row directly in a Table gets its own row group, so the DOM stays valid
  // (table > tbody > tr). A table can have many tbody elements.
  const isDirectChild = parent !== null && !parent.isInSection;
  if (!isDirectChild) return row;
  const Group = isHeader ? "thead" : "tbody";
  return <Group>{row}</Group>;
}

function TableCell(props: TableCellProps) {
  const parent = useContext(TableContext);
  const isHeader = props.header === true || parent?.isHeader === true;
  // A header cell in a header row names a column. Else it names its row.
  const scope = parent?.isHeader ? "col" : "row";
  const Tag = isHeader ? "th" : "td";
  return (
    <Tag
      scope={isHeader ? scope : undefined}
      colSpan={props.colSpan}
      rowSpan={props.rowSpan}
      {...cellAttributes({
        isHeader,
        hasDivider: parent?.dividers ?? true,
        align: props.align,
        vAlign: props.vAlign,
        width: props.width,
        padding: props.padding,
      })}
    >
      {props.text === undefined ? null : cellText(props.text)}
      {props.children}
    </Tag>
  );
}

// ---- List ----

interface ListContextValue {
  marker: ListMarker;
  hasConnector: boolean;
  maxMarkerSize?: number;
}

const ListContext = createContext<ListContextValue | null>(null);

const isNativeMarker = (marker: string | undefined) =>
  marker === "bullet" || marker === "number";

function listStyle(marker: ListMarker, gap: number | string | undefined) {
  const listStyleType =
    marker === "number" ? "decimal" : marker === "bullet" ? "disc" : "none";
  return {
    margin: 0,
    paddingInlineStart: isNativeMarker(marker) ? "1.5em" : 0,
    listStyleType,
    display: "flex",
    flexDirection: "column",
    gap: spacing(gap ?? 1),
  } satisfies CSSProperties;
}

/** A plain button: no box, the full row is the hit area, a focus ring. */
const ITEM_BUTTON_STYLE: CSSProperties = {
  display: "block",
  width: "100%",
  margin: 0,
  padding: 0,
  border: 0,
  background: "none",
  textAlign: "start",
  cursor: "pointer",
  boxSizing: "border-box",
  borderRadius: radius("xs"),
};

function ItemBody({
  label,
  value,
  description,
  icon,
  marker,
  markerSize,
  hasConnector,
  onPick,
  extra,
}: {
  label?: string;
  value?: string | number;
  description?: string;
  icon?: string;
  marker?: string;
  markerSize?: number;
  hasConnector?: boolean;
  onPick?: () => void;
  extra?: ReactNode;
}) {
  const hasLeading =
    icon !== undefined || (marker !== undefined && !isNativeMarker(marker));
  const leading = hasLeading ? (
    <span
      aria-hidden="true"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: markerSize ?? 20,
        maxWidth: markerSize,
        paddingTop: 2,
        color: textColor("secondary"),
      }}
    >
      {icon ? <LucideIcon name={icon} size="sm" /> : marker}
    </span>
  ) : null;
  const row = (
    <span
      style={{
        display: hasLeading ? "flex" : "block",
        gap: spacing(2),
        alignItems: "flex-start",
        borderInlineStart: hasConnector
          ? `2px solid ${borderColor("default")}`
          : undefined,
        paddingInlineStart: hasConnector ? spacing(3) : undefined,
      }}
    >
      {leading}
      <span
        style={{
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          flex: 1,
        }}
      >
        {label || value !== undefined ? (
          <span
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: spacing(3),
              ...textFont("md"),
              color: textColor("default"),
            }}
          >
            <span>{label}</span>
            {value !== undefined ? (
              <span
                data-a2ui-list-value=""
                style={{
                  fontWeight: FONT_WEIGHT.medium,
                  fontVariantNumeric: "tabular-nums",
                  textAlign: "end",
                  flex: "none",
                }}
              >
                {String(value)}
              </span>
            ) : null}
          </span>
        ) : null}
        {description ? (
          <span style={{ ...textFont("sm"), color: textColor("secondary") }}>
            {description}
          </span>
        ) : null}
        {extra}
      </span>
    </span>
  );
  if (!onPick) return row;
  return (
    <button
      type="button"
      data-a2ui-input=""
      onClick={(event) => {
        event.stopPropagation();
        onPick();
      }}
      style={ITEM_BUTTON_STYLE}
    >
      {row}
    </button>
  );
}

function itemEntry(item: ListItemValue) {
  return typeof item === "string" ? { label: item } : item;
}

function List(props: ListProps) {
  useStandardStyles();
  const marker = props.marker ?? "bullet";
  const hasConnector = props.connector === "solid";
  const Tag = marker === "number" ? "ol" : "ul";
  const items = props.items ?? [];
  const action = props.action;
  const body =
    items.length > 0
      ? items.map((item, index) => {
          const entry = itemEntry(item);
          const value = "value" in entry ? entry.value : undefined;
          const onPick = action
            ? () =>
                void action({
                  index,
                  label: entry.label,
                  value: value === undefined ? undefined : String(value),
                })
            : undefined;
          return (
            <li key={`${entry.label}-${index}`}>
              <ItemBody
                label={entry.label}
                // With an action, the value is the payload of the pick.
                value={action ? undefined : value}
                description={
                  "description" in entry ? entry.description : undefined
                }
                icon={"icon" in entry ? entry.icon : undefined}
                markerSize={props.maxMarkerSize}
                hasConnector={hasConnector}
                onPick={onPick}
              />
            </li>
          );
        })
      : props.children;
  return (
    <ListContext.Provider
      value={{ marker, hasConnector, maxMarkerSize: props.maxMarkerSize }}
    >
      <Tag
        className="a2ui-std-list"
        data-a2ui-std=""
        // Safari drops the list role when list-style is "none".
        role={isNativeMarker(marker) ? undefined : "list"}
        start={Tag === "ol" ? props.start : undefined}
        style={listStyle(marker, props.gap)}
      >
        {body}
      </Tag>
    </ListContext.Provider>
  );
}

function ListItem(props: ListItemProps) {
  const list = useContext(ListContext);
  const Tag = list ? "li" : "div";
  const isDisabled = props.disabled === true;
  const action = isDisabled ? undefined : props.action;
  // An own marker replaces the native bullet or number.
  const hidesNativeMarker =
    props.marker !== undefined && isNativeMarker(list?.marker);
  return (
    <Tag
      aria-disabled={isDisabled || undefined}
      style={{
        ...(hidesNativeMarker ? { listStyleType: "none" } : {}),
        opacity: isDisabled ? 0.5 : undefined,
      }}
    >
      <ItemBody
        label={props.label}
        value={action ? undefined : props.value}
        description={props.description}
        icon={props.icon}
        marker={props.marker}
        markerSize={props.markerSize ?? list?.maxMarkerSize}
        hasConnector={list?.hasConnector}
        onPick={action ? () => void action({}) : undefined}
        extra={props.children}
      />
    </Tag>
  );
}

/**
 * The standard data components: tables, lists, a chart and a map. Give
 * them to `createGenerativeUI({ components: { ...dataComponents } })`.
 *
 * - Table: `children` (TableSection or TableRow ids, or a template) and
 *   `cellComponents` (the components that `{ componentId }` cells show).
 * - List and ListItem: an `action` event. The List event gets the index,
 *   label and value of the picked item.
 * - Map: `selected` is writable, so a `{ path }` binding gets the choice of
 *   the user.
 */
export const dataComponents = {
  Table: {
    component: Table,
    description:
      'A data table. Put it in a plain Column, not in a Card. Give "columns" and "rows" (a list of row lists). Or give "children": TableSection or TableRow ids, or a template { "componentId", "path" } that repeats a TableRow for each item of a data list. To show a component (Badge, Button, Icon, Text) in a cell or a column header, set it to { "componentId": "<id>" } and put the id in "cellComponents".',
    props: tableSchema,
    slots: { children: "multiple", cellComponents: "multiple" } as const,
  },
  TableSection: {
    component: TableSection,
    description:
      "A group of TableRow children in a Table. With header true, it is the header of the table.",
    props: tableSectionSchema,
    slots: CHILDREN_SLOT,
  },
  TableRow: {
    component: TableRow,
    description:
      "A row of a Table. Its children are TableCell ids, or a template. With label, a header cell with that text starts the row.",
    props: tableRowSchema,
    slots: CHILDREN_SLOT,
  },
  TableCell: {
    component: TableCell,
    description:
      'A cell of a TableRow. It shows "text", or its children. With header true, it is a header cell.',
    props: tableCellSchema,
    slots: CHILDREN_SLOT,
  },
  List: {
    component: List,
    description:
      'A list in a Card or next to another component. A plain list of text is markdown, not a List. Give "items" (strings or { "label", "value"?, "description"?, "icon"? }); without an action, an item with a value is a key and value row, for facts like Price: $1,599. Or, when there are no items, give "children": ListItem ids or a template. With an "action", the user can pick an item: the event context gets "index", "label" and "value" of the item.',
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
    component: ListItem,
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
    component: Chart,
    description:
      'A bar, line, area, scatter, pie or donut chart. "data" is a list of objects. "xKey" is the field of the category. "series" are the value fields.',
    props: chartSchema,
  },
  Map: {
    component: MapView,
    description:
      'A map with markers. With "route", a line connects the markers in order. Bind "selected" to { "path": "/x" } to get the label of the marker that the user picks. When maps are not available, it shows a list of the places.',
    props: mapSchema,
    writable: ["selected"] as const,
  },
};
