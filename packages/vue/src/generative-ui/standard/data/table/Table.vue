<script setup lang="ts">
import { computed } from "vue";
import type { CSSProperties, VNode } from "vue";
import type { z } from "zod";
import {
  VISUALLY_HIDDEN,
  backgroundColor,
  textColor,
} from "@copilotkit/shared/generative-ui";
import type { tableSchema } from "@copilotkit/shared/generative-ui";
import { useStandardStyles } from "../../../standard-styles";
import { cellComponentId, cellStyle, cellText, normalizeColumn } from "./cell";
import type { NormalizedColumn } from "./cell";
import { provideTableContext } from "./table-context";

defineOptions({ name: "CopilotGenerativeUITable" });

type TableProps = z.output<typeof tableSchema>;

/**
 * A data table from `columns` and `rows`, or from TableSection and TableRow
 * children. A `{ componentId }` cell or column shows the child of that id
 * from the `cellComponents` slot.
 *
 * `dividers` defaults to `undefined`, not `false`, so the rows have
 * dividers unless the agent turns them off.
 */
const props = withDefaults(
  defineProps<{
    /** A name of the table for screen readers. It is not shown. */
    caption?: TableProps["caption"];
    columns?: TableProps["columns"];
    rows?: TableProps["rows"];
    columnSizing?: TableProps["columnSizing"];
    dividers?: TableProps["dividers"];
    /** Caps the table at 480px, scrolls it, and keeps the header on top. */
    stickyHeader?: TableProps["stickyHeader"];
    emptyLabel?: TableProps["emptyLabel"];
  }>(),
  { dividers: undefined },
);

const slots = defineSlots<{
  /** TableSection or TableRow children. */
  children?: () => VNode[];
  /** The components that `{ componentId }` cells and columns show. */
  cellComponents?: () => VNode[];
}>();

useStandardStyles();

const dividers = computed(() => props.dividers ?? true);
provideTableContext(() => ({
  dividers: dividers.value,
  isInSection: false,
  isHeader: false,
}));

const columns = computed(() => (props.columns ?? []).map(normalizeColumn));
const rows = computed(() => props.rows ?? []);
const columnCount = computed(() =>
  Math.max(columns.value.length, ...rows.value.map((row) => row.length), 1),
);

const tableStyle = computed<CSSProperties>(() => ({
  width: "100%",
  borderCollapse: "collapse",
  tableLayout: props.columnSizing === "equal" ? "fixed" : "auto",
}));
const wrapperStyle = computed<CSSProperties>(() => ({
  maxHeight: props.stickyHeader ? "480px" : undefined,
  overflowY: props.stickyHeader ? "auto" : undefined,
}));
const EMPTY_STYLE: CSSProperties = {
  ...cellStyle({ isHeader: false }),
  color: textColor("tertiary"),
  textAlign: "center",
};

/** The children render the table when there are no columns and no rows. */
function isChildrenMode() {
  const hasData = rows.value.length > 0 || columns.value.length > 0;
  return slots.children !== undefined && !hasData;
}

function hasDivider(rowIndex: number) {
  return dividers.value && rowIndex < rows.value.length - 1;
}

function headerCellStyle(column: NormalizedColumn): CSSProperties {
  const sticky: CSSProperties = props.stickyHeader
    ? { position: "sticky", top: 0, background: backgroundColor("surface") }
    : {};
  return {
    ...cellStyle({ isHeader: true, align: column.align, width: column.width }),
    ...sticky,
  };
}

function bodyCellStyle(columnIndex: number) {
  return cellStyle({
    isHeader: false,
    align: columns.value[columnIndex]?.align,
  });
}

/**
 * The `cellComponents` children by component id: the engine keys each child
 * by its id. A new slot function comes with each render of the parent, so
 * the map is built once per slot function, not once per cell.
 */
let cellComponents:
  | { slot: (() => VNode[]) | undefined; byId: Map<string, VNode> }
  | undefined;

function componentById(id: string | undefined) {
  if (id === undefined) return undefined;
  const slot = slots.cellComponents;
  const cached = cellComponents;
  const isCached = cached !== undefined && cached.slot === slot;
  const current = isCached
    ? cached
    : { slot, byId: vnodesById(slot?.() ?? []) };
  cellComponents = current;
  return current.byId.get(id);
}

function vnodesById(vnodes: VNode[]) {
  const byId = new Map<string, VNode>();
  for (const vnode of vnodes) {
    if (typeof vnode.key === "string") byId.set(vnode.key, vnode);
  }
  return byId;
}
</script>

<template>
  <div class="a2ui-std-table-wrap" data-a2ui-std="" :style="wrapperStyle">
    <table class="a2ui-std-table" :style="tableStyle">
      <caption v-if="props.caption" :style="VISUALLY_HIDDEN">
        {{
          props.caption
        }}
      </caption>
      <slot v-if="isChildrenMode()" name="children" />
      <template v-else>
        <thead v-if="columns.length > 0">
          <tr>
            <th
              v-for="(column, index) in columns"
              :key="`${column.label ?? column.componentId}-${index}`"
              scope="col"
              class="a2ui-std-cell"
              data-divider=""
              :style="headerCellStyle(column)"
            >
              <template v-if="column.label">{{ column.label }}</template>
              <component
                :is="componentById(column.componentId)"
                v-if="componentById(column.componentId)"
              />
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="rows.length === 0">
            <td
              :colspan="columnCount"
              class="a2ui-std-cell"
              :style="EMPTY_STYLE"
            >
              {{ props.emptyLabel ?? "No rows" }}
            </td>
          </tr>
          <template v-else>
            <tr v-for="(row, rowIndex) in rows" :key="rowIndex">
              <td
                v-for="(value, columnIndex) in row"
                :key="columnIndex"
                class="a2ui-std-cell"
                :data-divider="hasDivider(rowIndex) ? '' : undefined"
                :style="bodyCellStyle(columnIndex)"
              >
                <template v-if="cellComponentId(value) === undefined">{{
                  cellText(value)
                }}</template>
                <component
                  :is="componentById(cellComponentId(value))"
                  v-else-if="componentById(cellComponentId(value))"
                />
              </td>
            </tr>
          </template>
        </tbody>
      </template>
    </table>
  </div>
</template>
