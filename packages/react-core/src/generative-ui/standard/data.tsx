import React, { createContext, isValidElement, useContext } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { z } from "zod";
import {
  FONT_WEIGHT,
  backgroundColor,
  borderColor,
  dataDeclarations,
  radius,
  spacing,
  textColor,
  textFont,
  withComponents,
} from "@copilotkit/shared/generative-ui";
import type {
  ListItemValue,
  ListMarker,
  ListSelection,
  TableColumn,
  listItemSchema,
  listSchema,
  tableCellSchema,
  tableRowSchema,
  tableSchema,
  tableSectionSchema,
} from "@copilotkit/shared/generative-ui";
import { LucideIcon } from "./media";
import { Chart, VISUALLY_HIDDEN } from "./Chart";
import { MapView } from "./Map";
import { useGenerativeUIAccessibility } from "../accessibility";
import { useStandardStyles } from "./styles";

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
  const aria = useGenerativeUIAccessibility();
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
      <Tag {...aria}>{props.children}</Tag>
    </TableContext.Provider>
  );
}

function TableRow(props: TableRowProps) {
  const aria = useGenerativeUIAccessibility();
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
      <tr {...aria}>
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
  const aria = useGenerativeUIAccessibility();
  const parent = useContext(TableContext);
  const isHeader = props.header === true || parent?.isHeader === true;
  // A header cell in a header row names a column. Else it names its row.
  const scope = parent?.isHeader ? "col" : "row";
  const Tag = isHeader ? "th" : "td";
  return (
    <Tag
      {...aria}
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

function listStyle(
  marker: ListMarker,
  props: Pick<ListProps, "gap" | "direction" | "align" | "weight">,
) {
  const listStyleType =
    marker === "number" ? "decimal" : marker === "bullet" ? "disc" : "none";
  const isHorizontal = props.direction === "horizontal";
  return {
    margin: 0,
    paddingInlineStart: isNativeMarker(marker) && !isHorizontal ? "1.5em" : 0,
    listStyleType: isHorizontal ? "none" : listStyleType,
    display: "flex",
    flexDirection: isHorizontal ? "row" : "column",
    alignItems: props.align ? ALIGN_CSS[props.align] : undefined,
    flexGrow: props.weight,
    overflowX: isHorizontal ? "auto" : undefined,
    gap: spacing(props.gap ?? (isHorizontal ? 3 : 1)),
  } satisfies CSSProperties;
}

const ALIGN_CSS = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
} as const;

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
        role={
          isNativeMarker(marker) && props.direction !== "horizontal"
            ? undefined
            : "list"
        }
        start={Tag === "ol" ? props.start : undefined}
        style={listStyle(marker, props)}
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
 * - Map: `selected` is writable, so a `{ "@path" }` binding gets the choice of
 *   the user.
 */
export const dataComponents = withComponents(dataDeclarations, {
  Table,
  TableSection,
  TableRow,
  TableCell,
  List,
  ListItem,
  Chart,
  Map: MapView,
});
