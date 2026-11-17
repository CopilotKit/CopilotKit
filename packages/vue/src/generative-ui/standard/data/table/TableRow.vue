<script setup lang="ts">
import { computed, h } from "vue";
import type { FunctionalComponent, VNode } from "vue";
import type { z } from "zod";
import type { tableRowSchema } from "@copilotkit/shared/generative-ui";
import { useGenerativeUIAccessibility } from "../../../accessibility";
import { useStandardStyles } from "../../../standard-styles";
import { cellStyle } from "./cell";
import { provideTableContext, useTableContext } from "./table-context";

defineOptions({ name: "CopilotGenerativeUITableRow" });

type TableRowProps = z.output<typeof tableRowSchema>;

/**
 * A row of a Table: a `<tr>` with its TableCell children. With `label`, a
 * row header cell with that text starts the row. It applies its
 * accessibility envelope itself, so no element sits between the table and
 * it.
 */
const props = defineProps<{
  header?: TableRowProps["header"];
  label?: TableRowProps["label"];
  labelColSpan?: TableRowProps["labelColSpan"];
}>();

defineSlots<{
  /** TableCell children. */
  children?: () => VNode[];
}>();

useStandardStyles();
const aria = useGenerativeUIAccessibility();
const parent = useTableContext();

const isHeader = computed(
  () => props.header === true || parent?.value.isHeader === true,
);
const dividers = computed(() => parent?.value.dividers ?? true);
provideTableContext(() => ({
  dividers: dividers.value,
  isInSection: true,
  isHeader: isHeader.value,
}));

const LABEL_STYLE = cellStyle({ isHeader: true, align: "start" });

/**
 * A row directly in a Table gets its own row group, so the DOM stays valid
 * (table > tbody > tr). A table can have many tbody elements.
 */
const group = computed(() => {
  const isDirectChild = parent !== null && !parent.value.isInSection;
  if (!isDirectChild) return undefined;
  return isHeader.value ? "thead" : "tbody";
});

/** Wraps the row in `tag`, or renders it as is without a tag. */
const RowGroup: FunctionalComponent<{ tag: "thead" | "tbody" | undefined }> = (
  groupProps,
  { slots },
) => {
  const row = slots.default?.();
  return groupProps.tag ? h(groupProps.tag, row) : row;
};
RowGroup.props = ["tag"];
</script>

<template>
  <RowGroup :tag="group">
    <tr v-bind="aria">
      <th
        v-if="props.label"
        scope="row"
        :colspan="props.labelColSpan"
        class="a2ui-std-cell"
        :data-divider="dividers ? '' : undefined"
        :style="LABEL_STYLE"
      >
        {{ props.label }}
      </th>
      <slot name="children" />
    </tr>
  </RowGroup>
</template>
