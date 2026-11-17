<script setup lang="ts">
import type { z } from "zod";
import type { inlineTextSchema } from "@copilotkit/shared/generative-ui";
import { useStandardStyles } from "../../standard-styles";

defineOptions({ name: "CopilotGenerativeUIUnderline" });

type InlineTextProps = z.output<typeof inlineTextSchema>;

/** A `<u>`. */
defineProps<{ text: InlineTextProps["text"] }>();

useStandardStyles();
</script>

<template>
  <u>{{ text }}</u>
</template>
