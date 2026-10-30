"use client";

import { createContext, isValidElement, useContext } from "react";
import type {
  CSSProperties,
  HTMLAttributes,
  ReactNode,
  ThHTMLAttributes,
} from "react";
import { Empty, Table as KumoTable } from "@cloudflare/kumo";
import { useGenerativeUIAccessibility } from "@copilotkit/react-core/v2/generative-ui";
import { VISUALLY_HIDDEN } from "./inline-markdown";
import { defined, sizeOf } from "./style";
import type { StandardProps } from "./types";

/** Where a row or cell sits: in a section, in the header. */
interface TableContextValue {
  isInSection: boolean;
  isHeader: boolean;
}
const TableContext = createContext<TableContextValue | null>(null);

const V_ALIGN = { start: "top", center: "middle", end: "bottom" } as const;

/**
 * The <th> attributes of a header cell. Kumo types Table.Head with plain
 * HTML attributes, which have no `scope`, `colSpan` or `rowSpan`, but it
 * passes every prop to the <th>.
 */
const thAttributes = (attributes: ThHTMLAttributes<HTMLTableCellElement>) =>
  attributes as HTMLAttributes<HTMLTableCellElement>;

/**
 * The rendered components of a "multiple" slot by component id. The engine
 * renders a list of ids as one element for each id, keyed by that id. Same
 * as the standard Table.
 */
export function elementsById(slot: ReactNode) {
  const byId = new Map<string, ReactNode>();
  const elements = Array.isArray(slot) ? slot : [];
  for (const element of elements) {
    if (isValidElement(element) && typeof element.key === "string") {
      byId.set(element.key, element);
    }
  }
  return byId;
}

/** The component id of a `{ componentId }` or `{ id }` cell. */
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

/** A component for a `{ componentId }` cell, else the cell value as text. */
function cellContent(value: unknown, components: Map<string, ReactNode>) {
  const id = cellComponentId(value);
  if (id === undefined) return cellText(value);
  return components.get(id) ?? null;
}

type TableColumn = NonNullable<StandardProps<"Table">["columns"]>[number];

interface Column {
  label?: string;
  align?: "start" | "center" | "end";
  width?: number | string;
  componentId?: string;
}

function columnOf(column: TableColumn): Column {
  if (typeof column === "string") return { label: column };
  const componentId = cellComponentId(column);
  return "label" in column ? { ...column, componentId } : { componentId };
}

function Caption({ text }: { text: string | undefined }) {
  if (!text) return null;
  return <caption style={VISUALLY_HIDDEN}>{text}</caption>;
}

/** The scroll box around a table: wide tables scroll sideways. */
function TableBox({
  children,
  stickyHeader,
}: {
  children: ReactNode;
  stickyHeader?: boolean;
}) {
  return (
    <div
      style={defined({
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        overflowX: "auto",
        maxHeight: stickyHeader ? 480 : undefined,
        overflowY: stickyHeader ? "auto" : undefined,
      })}
    >
      {children}
    </div>
  );
}

/**
 * Table: a Kumo Table, from `columns` and `rows`, or from TableSection and
 * TableRow children.
 */
export function Table(props: StandardProps<"Table">) {
  const columns = (props.columns ?? []).map(columnOf);
  const rows = props.rows ?? [];
  const components = elementsById(props.cellComponents);
  const layout = props.columnSizing === "equal" ? "fixed" : "auto";
  const isChildrenMode =
    props.children !== undefined && rows.length === 0 && columns.length === 0;
  if (isChildrenMode) {
    return (
      <TableBox stickyHeader={props.stickyHeader}>
        <TableContext.Provider value={{ isInSection: false, isHeader: false }}>
          <KumoTable layout={layout}>
            <Caption text={props.caption} />
            {props.children}
          </KumoTable>
        </TableContext.Provider>
      </TableBox>
    );
  }
  const columnCount = Math.max(
    columns.length,
    ...rows.map((row) => row.length),
    1,
  );
  return (
    <TableBox stickyHeader={props.stickyHeader}>
      <KumoTable layout={layout}>
        <Caption text={props.caption} />
        {columns.length > 0 ? (
          <KumoTable.Header sticky={props.stickyHeader}>
            <KumoTable.Row>
              {columns.map((column, index) => (
                <KumoTable.Head
                  key={`${column.label ?? column.componentId}-${index}`}
                  {...thAttributes({ scope: "col" })}
                  style={defined({
                    textAlign: column.align,
                    width: sizeOf(column.width),
                  })}
                >
                  {column.label}
                  {column.componentId
                    ? components.get(column.componentId)
                    : null}
                </KumoTable.Head>
              ))}
            </KumoTable.Row>
          </KumoTable.Header>
        ) : null}
        <KumoTable.Body>
          {rows.length === 0 ? (
            <KumoTable.Row>
              <KumoTable.Cell colSpan={columnCount}>
                <Empty size="sm" title={props.emptyLabel ?? "No rows"} />
              </KumoTable.Cell>
            </KumoTable.Row>
          ) : (
            rows.map((row, rowIndex) => (
              <KumoTable.Row key={rowIndex}>
                {row.map((value, columnIndex) => (
                  <KumoTable.Cell
                    key={columnIndex}
                    style={defined({ textAlign: columns[columnIndex]?.align })}
                  >
                    {cellContent(value, components)}
                  </KumoTable.Cell>
                ))}
              </KumoTable.Row>
            ))
          )}
        </KumoTable.Body>
      </KumoTable>
    </TableBox>
  );
}

/** TableSection: a Kumo Table header or body. */
export function TableSection(props: StandardProps<"TableSection">) {
  const aria = useGenerativeUIAccessibility();
  const isHeader = props.header === true;
  const Section = isHeader ? KumoTable.Header : KumoTable.Body;
  return (
    <TableContext.Provider value={{ isInSection: true, isHeader }}>
      <Section {...aria}>{props.children}</Section>
    </TableContext.Provider>
  );
}

/**
 * TableRow: a Kumo Table row. A row directly in the Table goes in a body,
 * because a table holds rows only inside sections.
 */
export function TableRow(props: StandardProps<"TableRow">) {
  const aria = useGenerativeUIAccessibility();
  const parent = useContext(TableContext);
  const isHeader = props.header === true || parent?.isHeader === true;
  const row = (
    <TableContext.Provider value={{ isInSection: true, isHeader }}>
      <KumoTable.Row {...aria}>
        {props.label ? (
          <KumoTable.Head
            {...thAttributes({ scope: "row", colSpan: props.labelColSpan })}
          >
            {props.label}
          </KumoTable.Head>
        ) : null}
        {props.children}
      </KumoTable.Row>
    </TableContext.Provider>
  );
  const isDirectChild = parent !== null && !parent.isInSection;
  if (!isDirectChild) return row;
  const Section = isHeader ? KumoTable.Header : KumoTable.Body;
  return <Section>{row}</Section>;
}

/** TableCell: a Kumo Table cell, or a column header in a header row. */
export function TableCell(props: StandardProps<"TableCell">) {
  const aria = useGenerativeUIAccessibility();
  const parent = useContext(TableContext);
  const isHeader = props.header === true || parent?.isHeader === true;
  const style: CSSProperties = defined({
    textAlign: props.align,
    verticalAlign: V_ALIGN[props.vAlign ?? "start"],
    width: sizeOf(props.width),
    padding: sizeOf(props.padding),
  });
  const content = (
    <>
      {props.text === undefined ? null : cellText(props.text)}
      {props.children}
    </>
  );
  if (isHeader) {
    return (
      <KumoTable.Head
        {...aria}
        {...thAttributes({
          scope: "col",
          colSpan: props.colSpan,
          rowSpan: props.rowSpan,
        })}
        style={style}
      >
        {content}
      </KumoTable.Head>
    );
  }
  return (
    <KumoTable.Cell
      {...aria}
      colSpan={props.colSpan}
      rowSpan={props.rowSpan}
      style={style}
    >
      {content}
    </KumoTable.Cell>
  );
}

export const tableOverrides = {
  Table: { component: Table },
  TableSection: { component: TableSection },
  TableRow: { component: TableRow },
  TableCell: { component: TableCell },
};
