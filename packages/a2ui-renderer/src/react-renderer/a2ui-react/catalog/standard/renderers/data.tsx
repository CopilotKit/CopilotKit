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

export { renderChildList };

type BoundChildList = unknown;

const hasChildren = (list: BoundChildList) =>
  Array.isArray(list) && list.length > 0;

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

function cellStyle(opts: {
  header: boolean;
  dividers: boolean;
  align?: string;
  vAlign?: string;
  width?: number | string;
  padding?: number | string;
}): React.CSSProperties {
  return {
    ...textFont("sm"),
    textAlign: opts.align ? H_ALIGN[opts.align] : "start",
    verticalAlign: V_ALIGN[opts.vAlign ?? "start"],
    padding: spacing(opts.padding) ?? `${spacing(2)} ${spacing(3)}`,
    width: spacing(opts.width),
    fontWeight: opts.header ? FONT_WEIGHT.semibold : undefined,
    color: opts.header ? textColor("secondary") : textColor("default"),
    borderBottom: opts.dividers
      ? `1px solid ${borderColor("subtle")}`
      : undefined,
  };
}

function normalizeColumn(c: TableColumn) {
  return typeof c === "string" ? { label: c } : c;
}

function Table({ props, children }: RendererProps<any>) {
  const dividers = props.dividers ?? true;
  const columns = (props.columns ?? []).map(normalizeColumn);
  const rows: unknown[][] = props.rows ?? [];
  const equal = props.columnSizing === "equal";
  const tableStyle: React.CSSProperties = {
    width: "100%",
    borderCollapse: "collapse",
    tableLayout: equal ? "fixed" : "auto",
  };
  const wrapperStyle: React.CSSProperties = {
    width: "100%",
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
      <div style={wrapperStyle}>
        <TableContext.Provider
          value={{ dividers, inSection: false, header: false }}
        >
          <table style={tableStyle}>
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
    <div style={wrapperStyle}>
      <table style={tableStyle}>
        {columns.length > 0 ? (
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th
                  key={`${c.label}-${i}`}
                  scope="col"
                  style={{
                    ...cellStyle({
                      header: true,
                      dividers: true,
                      align: c.align,
                      width: c.width,
                    }),
                    position: props.stickyHeader ? "sticky" : undefined,
                    top: props.stickyHeader ? 0 : undefined,
                    background: props.stickyHeader
                      ? backgroundColor("surface")
                      : undefined,
                  }}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columnCount}
                style={{
                  ...cellStyle({ header: false, dividers: false }),
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
                    style={cellStyle({
                      header: false,
                      dividers: dividers && r < rows.length - 1,
                      align:
                        columns[c] && "align" in columns[c]
                          ? (columns[c] as { align?: string }).align
                          : undefined,
                    })}
                  >
                    {cellText(value)}
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
      <tr aria-label={props.label}>
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
      style={cellStyle({
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
  connector,
  action,
  extra,
}: {
  label?: React.ReactNode;
  description?: React.ReactNode;
  icon?: string;
  marker?: string;
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
          minWidth: 20,
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
  const items: ListItemValue[] | undefined = props.items;
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
                connector={connector}
                action={action}
              />
            </li>
          );
        })
      : renderChildList(props.children, children);
  return (
    <ListContext.Provider value={{ marker, connector }}>
      <Tag
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
  const action = typeof props.action === "function" ? props.action : undefined;
  return (
    <Tag
      style={
        props.marker &&
        list &&
        (list.marker === "bullet" || list.marker === "number")
          ? { listStyleType: "none" }
          : undefined
      }
    >
      <ItemBody
        label={props.label === undefined ? undefined : cellText(props.label)}
        description={
          props.description === undefined
            ? undefined
            : cellText(props.description)
        }
        icon={props.icon}
        marker={props.marker}
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
