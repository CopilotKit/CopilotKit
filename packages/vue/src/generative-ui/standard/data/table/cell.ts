import type { CSSProperties } from "vue";
import type { z } from "zod";
import {
  FONT_WEIGHT,
  isRecord,
  spacing,
  textColor,
  textFont,
} from "@copilotkit/shared/generative-ui";
import type {
  TableColumn,
  tableCellSchema,
} from "@copilotkit/shared/generative-ui";

type TableCellProps = z.output<typeof tableCellSchema>;

const V_ALIGN = { start: "top", center: "middle", end: "bottom" } as const;

/**
 * The style of a cell: 14px text, 8px padding (none at the outer edges),
 * medium weight for headers. The padding, edges and dividers come from the
 * `.a2ui-std-cell` rules, so a `padding` prop still wins.
 */
export function cellStyle(
  options: { isHeader: boolean } & Pick<
    TableCellProps,
    "align" | "vAlign" | "width" | "padding"
  >,
) {
  return {
    ...textFont("sm"),
    textAlign: options.align ?? "start",
    verticalAlign: V_ALIGN[options.vAlign ?? "start"],
    padding: spacing(options.padding),
    width: spacing(options.width),
    fontWeight: options.isHeader ? FONT_WEIGHT.medium : undefined,
    color: textColor("default"),
  } satisfies CSSProperties;
}

/** The component id of a `{ componentId }` or `{ id }` cell, else `undefined`. */
export function cellComponentId(value: unknown) {
  if (!isRecord(value)) return undefined;
  if ("componentId" in value && typeof value.componentId === "string") {
    return value.componentId || undefined;
  }
  if ("id" in value && typeof value.id === "string") {
    return value.id || undefined;
  }
  return undefined;
}

/** The text of a cell value: empty for `null`, JSON for an object. */
export function cellText(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** A column with an optional label, alignment, width and component id. */
export type NormalizedColumn = Partial<Extract<TableColumn, { label: string }>>;

/** A column as one shape: a string is a label, a `{ id }` is a component id. */
export function normalizeColumn(column: TableColumn): NormalizedColumn {
  if (typeof column === "string") return { label: column };
  const componentId = cellComponentId(column);
  return "label" in column ? { ...column, componentId } : { componentId };
}
