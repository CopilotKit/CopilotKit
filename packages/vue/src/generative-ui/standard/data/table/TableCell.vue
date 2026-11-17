<script setup lang="ts">
import { computed } from "vue";
import type { VNode } from "vue";
import type { z } from "zod";
import type { tableCellSchema } from "@copilotkit/shared/generative-ui";
import { useGenerativeUIAccessibility } from "../../../accessibility";
import { useStandardStyles } from "../../../standard-styles";
import { cellStyle, cellText } from "./cell";
import { useTableContext } from "./table-context";

defineOptions({ name: "CopilotGenerativeUITableCell" });

type TableCellProps = z.output<typeof tableCellSchema>;

/**
 * A cell of a TableRow: a `<th>` in a header row or with `header`, else a
 * `<td>`. It shows `text`, then its children. It applies its accessibility
 * envelope itself, so no element sits between the row and it.
 */
const props = defineProps<{
  text?: TableCellProps["text"];
  header?: TableCellProps["header"];
  align?: TableCellProps["align"];
  vAlign?: TableCellProps["vAlign"];
  colSpan?: TableCellProps["colSpan"];
  rowSpan?: TableCellProps["rowSpan"];
  width?: TableCellProps["width"];
  padding?: TableCellProps["padding"];
}>();

defineSlots<{
  /** The components the cell shows after its text. */
  children?: () => VNode[];
}>();

useStandardStyles();
const aria = useGenerativeUIAccessibility();
const parent = useTableContext();

const isHeader = computed(
  () => props.header === true || parent?.value.isHeader === true,
);
/** A header cell in a header row names a column. Else it names its row. */
const scope = computed(() => {
  if (!isHeader.value) return undefined;
  return parent?.value.isHeader ? "col" : "row";
});
const hasDivider = computed(() => parent?.value.dividers ?? true);
const style = computed(() =>
  cellStyle({
    isHeader: isHeader.value,
    align: props.align,
    vAlign: props.vAlign,
    width: props.width,
    padding: props.padding,
  }),
);
</script>

<template>
  <component
    :is="isHeader ? 'th' : 'td'"
    v-bind="aria"
    :scope="scope"
    :colspan="props.colSpan"
    :rowspan="props.rowSpan"
    class="a2ui-std-cell"
    :data-divider="hasDivider ? '' : undefined"
    :style="style"
  >
    <template v-if="props.text !== undefined">{{
      cellText(props.text)
    }}</template>
    <slot name="children" />
  </component>
</template>
