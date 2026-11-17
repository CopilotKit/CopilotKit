<script setup lang="ts">
import { computed } from "vue";
import { spacing } from "@copilotkit/shared/generative-ui";
import type { spacerSchema } from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import { useStandardStyles } from "../../standard-styles";

defineOptions({ name: "CopilotGenerativeUISpacer" });

/** A flexible gap that takes the free space, hidden from screen readers. */
const props = defineProps<{
  minSize?: z.output<typeof spacerSchema>["minSize"];
}>();

useStandardStyles();
const style = computed(() => ({
  flex: 1,
  minWidth: spacing(props.minSize ?? 2),
  minHeight: spacing(props.minSize ?? 2),
}));
</script>

<template>
  <div aria-hidden="true" :style="style" />
</template>
