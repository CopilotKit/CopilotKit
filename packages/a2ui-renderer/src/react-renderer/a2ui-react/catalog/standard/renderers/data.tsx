import React, { createContext, useContext } from "react";
import type {
  CatalogRenderers,
  RendererProps,
} from "../../../../create-catalog";
import type {
  ListItemValue,
  TableColumn,
  dataDefinitions,
} from "../definitions/data";
import {
  FONT_WEIGHT,
  backgroundColor,
  borderColor,
  spacing,
  textColor,
  textFont,
} from "../tokens";
import { Chart } from "./Chart";
import { MapView } from "./Map";
import { LucideIcon } from "./media";
import { renderChildList } from "./layout";
import { useStandardStyles } from "../styles";

export { renderChildList };

type BoundChildList = unknown;

const hasChildren = (list: BoundChildList) =>
  Array.isArray(list) && list.length > 0;

/**
 * Array props may be bound to a data path (see `bindable`); the binder hands
 * over whatever the path holds, so treat a missing or non-array value as [].
 */
const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/**
 * The component id of a `{ "componentId": "<id>" }` (or `{ "id": "<id>" }`)
 * table cell, or undefined for plain values.
 */
const cellComponentId = (v: unknown): string | undefined => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const o = v as { componentId?: unknown; id?: unknown };
  if (typeof o.componentId === "string" && o.componentId) return o.componentId;
  if (typeof o.id === "string" && o.id) return o.id;
  return undefined;
};

/** Cell content: a built child component for `{ componentId }`, else text. */
const cellContent = (
  v: unknown,
  children: RendererProps["children"],
): React.ReactNode => {
  const id = cellComponentId(v);
  return id ? renderChildList([id], children) : cellText(v);
};

const cellText = (v: unknown): string => {
  if (v === undefined || v === null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

// ─── Table ───────────────────────────────────────────────────────────

interface TableContextValue {
  dividers: boolean;
  /** True inside a TableSection (rows render a bare <tr>). */
  inSection: boolean;
  /** True inside a header section/row (cells render <th>). */
  header: boolean;
}

const TableContext = createContext<TableContextValue | null>(null);

const V_ALIGN: Record<string, React.CSSProperties["verticalAlign"]> = {
  start: "top",
  center: "middle",
  end: "bottom",
};
const H_ALIGN: Record<string, React.CSSProperties["textAlign"]> = {
  start: "start",
  center: "center",
  end: "end",
};

/*
 * ChatGPT tables: 14px/20px cells with 8px padding (flush at the outer
 * edges), 500-weight header labels in the default ink, hairline
 * rgba(0,0,0,.05) row dividers, no outer border. Padding, edge flushing
 * and dividers live in the injected stylesheet (`.a2ui-std-cell`) so an
 * explicit `padding` prop still wins inline.
 */
function cellProps(opts: {
  header: boolean;
  dividers: boolean;
  align?: string;
  vAlign?: string;
  width?: number | string;
  padding?: number | string;
}): {
  className: string;
  "data-divider"?: string;
  style: React.CSSProperties;
} {
  return {
    className: "a2ui-std-cell",
    "data-divider": opts.dividers ? "" : undefined,
    style: {
      ...textFont("sm"),
      textAlign: opts.align ? H_ALIGN[opts.align] : "start",
      verticalAlign: V_ALIGN[opts.vAlign ?? "start"],
      padding: spacing(opts.padding),
      width: spacing(opts.width),
      fontWeight: opts.header ? FONT_WEIGHT.medium : undefined,
      color: textColor("default"),
    },
  };
}

interface NormalizedColumn {
  label?: string;
  align?: string;
  width?: number | string;
  componentId?: string;
}

function normalizeColumn(c: TableColumn): NormalizedColumn {
  if (typeof c === "string") return { label: c };
  const componentId = cellComponentId(c);
  return "label" in c ? { ...c, componentId } : { componentId };
}

function Table({ props, children }: RendererProps<any>) {
  useStandardStyles();
  const dividers = props.dividers ?? true;
  const columns = asArray<TableColumn>(props.columns).map(normalizeColumn);
  const rows = asArray<unknown[]>(props.rows);
  const equal = props.columnSizing === "equal";
  const tableStyle: React.CSSProperties = {
    width: "100%",
    borderCollapse: "collapse",
    tableLayout: equal ? "fixed" : "auto",
  };
  const wrapperStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    overflowX: "auto",
    maxHeight: props.stickyHeader ? 480 : undefined,
    overflowY: props.stickyHeader ? "auto" : undefined,
  };

  if (
    hasChildren(props.children) &&
    rows.length === 0 &&
    columns.length === 0
  ) {
    return (
      <div
        className="a2ui-std-table-wrap"
        data-a2ui-std=""
        style={wrapperStyle}
      >
        <TableContext.Provider
          value={{ dividers, inSection: false, header: false }}
        >
          <table className="a2ui-std-table" style={tableStyle}>
            {renderChildList(props.children, children)}
          </table>
        </TableContext.Provider>
      </div>
    );
  }

  const columnCount = Math.max(
    columns.length,
    ...rows.map((r) => (Array.isArray(r) ? r.length : 0)),
    1,
  );

  return (
    <div className="a2ui-std-table-wrap" data-a2ui-std="" style={wrapperStyle}>
      <table className="a2ui-std-table" style={tableStyle}>
        {columns.length > 0 ? (
          <thead>
            <tr>
              {columns.map((c, i) => {
                const cell = cellProps({
                  header: true,
                  dividers: true,
                  align: c.align,
                  width: c.width,
                });
                return (
                  <th
                    key={`${c.label ?? c.componentId}-${i}`}
                    scope="col"
                    {...cell}
                    style={{
                      ...cell.style,
                      position: props.stickyHeader ? "sticky" : undefined,
                      top: props.stickyHeader ? 0 : undefined,
                      background: props.stickyHeader
                        ? backgroundColor("surface")
                        : undefined,
                    }}
                  >
                    {c.label}
                    {c.componentId
                      ? renderChildList([c.componentId], children)
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
                  ...cellProps({ header: false, dividers: false }).style,
                  color: textColor("tertiary"),
                  textAlign: "center",
                }}
              >
                {props.emptyLabel ?? "No rows"}
              </td>
            </tr>
          ) : (
            rows.map((row, r) => (
              <tr key={r}>
                {(Array.isArray(row) ? row : [row]).map((value, c) => (
                  <td
                    key={c}
                    {...cellProps({
                      header: false,
                      dividers: dividers && r < rows.length - 1,
                      align: columns[c]?.align,
                    })}
                  >
                    {cellContent(value, children)}
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

function TableSection({ props, children }: RendererProps<any>) {
  const parent = useContext(TableContext);
  const header = !!props.header;
  const Tag = header ? "thead" : "tbody";
  return (
    <TableContext.Provider
      value={{
        dividers: props.rowDivider ?? parent?.dividers ?? true,
        inSection: true,
        header,
      }}
    >
      <Tag>{renderChildList(props.children, children)}</Tag>
    </TableContext.Provider>
  );
}

function TableRow({ props, children }: RendererProps<any>) {
  const parent = useContext(TableContext);
  const header = !!props.header || !!parent?.header;
  const row = (
    <TableContext.Provider
      value={{
        dividers: parent?.dividers ?? true,
        inSection: true,
        header,
      }}
    >
      <tr>
        {props.label ? (
          <th
            scope="row"
            colSpan={props.labelColSpan}
            {...cellProps({
              header: true,
              dividers: parent?.dividers ?? true,
              align: "start",
            })}
          >
            {props.label}
          </th>
        ) : null}
        {renderChildList(props.children, children)}
      </tr>
    </TableContext.Provider>
  );
  // A row placed directly in a Table gets its own row group, so the DOM stays
  // valid (<table> > <tbody> > <tr>); multiple <tbody> elements are allowed.
  if (parent && !parent.inSection) {
    const Group = header ? "thead" : "tbody";
    return <Group>{row}</Group>;
  }
  return row;
}

function TableCell({ props, children }: RendererProps<any>) {
  const parent = useContext(TableContext);
  const header = !!props.header || !!parent?.header;
  const Tag = header ? "th" : "td";
  return (
    <Tag
      colSpan={props.colSpan}
      rowSpan={props.rowSpan}
      {...cellProps({
        header,
        dividers: parent?.dividers ?? true,
        align: props.align,
        vAlign: props.vAlign,
        width: props.width,
        padding: props.padding,
      })}
    >
      {props.text !== undefined && props.text !== null
        ? cellText(props.text)
        : null}
      {renderChildList(props.children, children)}
    </Tag>
  );
}

// ─── List ────────────────────────────────────────────────────────────

interface ListContextValue {
  marker: "bullet" | "number" | "rich" | "none";
  connector: boolean;
  maxMarkerSize?: number;
}

const ListContext = createContext<ListContextValue | null>(null);

function listStyle(
  marker: ListContextValue["marker"],
  gap: number | string | undefined,
): React.CSSProperties {
  const native = marker === "bullet" || marker === "number";
  return {
    margin: 0,
    paddingInlineStart: native ? "1.5em" : 0,
    listStyleType:
      marker === "number" ? "decimal" : marker === "bullet" ? "disc" : "none",
    display: "flex",
    flexDirection: "column",
    gap: spacing(gap ?? 1),
  };
}

function ItemBody({
  label,
  description,
  icon,
  marker,
  markerSize,
  connector,
  action,
  extra,
}: {
  label?: React.ReactNode;
  description?: React.ReactNode;
  icon?: string;
  marker?: string;
  markerSize?: number;
  connector?: boolean;
  action?: () => void;
  extra?: React.ReactNode;
}) {
  const content = (
    <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      {label !== undefined && label !== null && label !== "" ? (
        <span style={{ ...textFont("md"), color: textColor("default") }}>
          {label}
        </span>
      ) : null}
      {description ? (
        <span style={{ ...textFont("sm"), color: textColor("secondary") }}>
          {description}
        </span>
      ) : null}
      {extra}
    </span>
  );
  const leading =
    icon || (marker && marker !== "bullet" && marker !== "number") ? (
      <span
        aria-hidden
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: markerSize ?? 20,
          maxWidth: markerSize,
          paddingTop: 2,
          color: textColor("secondary"),
          position: "relative",
        }}
      >
        {icon ? <LucideIcon name={icon} size="sm" /> : marker}
      </span>
    ) : null;
  const row = (
    <span
      style={{
        display: leading ? "flex" : "block",
        gap: spacing(2),
        alignItems: "flex-start",
        borderInlineStart: connector
          ? `2px solid ${borderColor("default")}`
          : undefined,
        paddingInlineStart: connector ? spacing(3) : undefined,
      }}
    >
      {leading}
      {content}
    </span>
  );
  if (!action) return row;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        action();
      }}
      style={{
        all: "unset",
        display: "block",
        width: "100%",
        cursor: "pointer",
        boxSizing: "border-box",
      }}
    >
      {row}
    </button>
  );
}

function List({ props, children, dispatch }: RendererProps<any>) {
  const marker: ListContextValue["marker"] = props.marker ?? "bullet";
  const connector = props.connector === "solid";
  const Tag = marker === "number" ? "ol" : "ul";
  const items = asArray<ListItemValue>(props.items);
  const body =
    items && items.length > 0
      ? items.map((item, i) => {
          const entry = typeof item === "string" ? { label: item } : item;
          const action =
            "action" in entry && entry.action && dispatch
              ? () => dispatch(entry.action)
              : undefined;
          return (
            <li key={`${entry.label}-${i}`}>
              <ItemBody
                label={entry.label}
                description={
                  "description" in entry ? entry.description : undefined
                }
                icon={"icon" in entry ? entry.icon : undefined}
                markerSize={props.maxMarkerSize}
                connector={connector}
                action={action}
              />
            </li>
          );
        })
      : renderChildList(props.children, children);
  return (
    <ListContext.Provider
      value={{ marker, connector, maxMarkerSize: props.maxMarkerSize }}
    >
      <Tag
        className="a2ui-std-list"
        start={Tag === "ol" ? props.start : undefined}
        style={listStyle(marker, props.gap)}
      >
        {body}
      </Tag>
    </ListContext.Provider>
  );
}

function ListItem({ props, children }: RendererProps<any>) {
  const list = useContext(ListContext);
  const Tag = list ? "li" : "div";
  const disabled = !!props.disabled;
  const action =
    !disabled && typeof props.action === "function" ? props.action : undefined;
  return (
    <Tag
      aria-disabled={disabled || undefined}
      style={{
        ...(props.marker &&
        list &&
        (list.marker === "bullet" || list.marker === "number")
          ? { listStyleType: "none" }
          : {}),
        opacity: disabled ? 0.5 : undefined,
      }}
    >
      <ItemBody
        label={props.label == null ? undefined : cellText(props.label)}
        description={
          props.description == null ? undefined : cellText(props.description)
        }
        icon={props.icon}
        marker={props.marker}
        markerSize={props.markerSize ?? list?.maxMarkerSize}
        connector={list?.connector}
        action={action}
        extra={renderChildList(props.children, children)}
      />
    </Tag>
  );
}

export const dataRenderers = {
  Table,
  TableSection,
  TableRow,
  TableCell,
  List,
  ListItem,
  Chart,
  Map: MapView,
} satisfies CatalogRenderers<typeof dataDefinitions>;
