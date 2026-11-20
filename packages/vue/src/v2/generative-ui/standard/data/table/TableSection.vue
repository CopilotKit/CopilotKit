<script setup lang="ts">
import type { VNode } from "vue";
import type { z } from "zod";
import type { tableSectionSchema } from "@copilotkit/shared/generative-ui";
import { useGenerativeUIAccessibility } from "../../../accessibility";
import { useStandardStyles } from "../../../standard-styles";
import { provideTableContext, useTableContext } from "./table-context";

defineOptions({ name: "CopilotGenerativeUITableSection" });

type TableSectionProps = z.output<typeof tableSectionSchema>;

/**
 * A group of TableRow children: a `<thead>` with `header`, else a
 * `<tbody>`. The cells of a header section are column headers. It applies
 * its accessibility envelope itself, so no element sits between the table
 * and it.
 *
 * `rowDivider` defaults to `undefined`, not `false`, so the section keeps
 * the dividers of its Table.
 */
const props = withDefaults(
  defineProps<{
    header?: TableSectionProps["header"];
    rowDivider?: TableSectionProps["rowDivider"];
  }>(),
  { rowDivider: undefined },
);

defineSlots<{
  /** TableRow children. */
  children?: () => VNode[];
}>();

useStandardStyles();
const aria = useGenerativeUIAccessibility();
const parent = useTableContext();

provideTableContext(() => ({
  dividers: props.rowDivider ?? parent?.value.dividers ?? true,
  isInSection: true,
  isHeader: props.header === true,
}));
</script>

<template>
  <component :is="props.header ? 'thead' : 'tbody'" v-bind="aria">
    <slot name="children" />
  </component>
</template>
