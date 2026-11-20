<script setup lang="ts">
import { computed } from "vue";
import type { z } from "zod";
import { FONT_WEIGHT } from "@copilotkit/shared/generative-ui";
import type { boldSchema } from "@copilotkit/shared/generative-ui";
import { useStandardStyles } from "../../standard-styles";

defineOptions({ name: "CopilotGenerativeUIBold" });

type BoldProps = z.output<typeof boldSchema>;

/** A `<strong>`, with an optional weight. */
const props = defineProps<{
  text: BoldProps["text"];
  fontWeight?: BoldProps["fontWeight"];
}>();

useStandardStyles();

const fontWeight = computed(() =>
  props.fontWeight ? FONT_WEIGHT[props.fontWeight] : undefined,
);
</script>

<template>
  <strong :style="{ fontWeight }">{{ text }}</strong>
</template>
