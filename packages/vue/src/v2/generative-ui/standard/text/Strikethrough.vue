<script setup lang="ts">
import type { z } from "zod";
import type { inlineTextSchema } from "@copilotkit/shared/generative-ui";
import { useStandardStyles } from "../../standard-styles";

defineOptions({ name: "CopilotGenerativeUIStrikethrough" });

type InlineTextProps = z.output<typeof inlineTextSchema>;

/** An `<s>`. */
defineProps<{ text: InlineTextProps["text"] }>();

useStandardStyles();
</script>

<template>
  <s>{{ text }}</s>
</template>
