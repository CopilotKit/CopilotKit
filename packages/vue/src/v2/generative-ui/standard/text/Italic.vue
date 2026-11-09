<script setup lang="ts">
import type { z } from "zod";
import type { inlineTextSchema } from "@copilotkit/shared/generative-ui";
import { useStandardStyles } from "../../standard-styles";

defineOptions({ name: "CopilotGenerativeUIItalic" });

type InlineTextProps = z.output<typeof inlineTextSchema>;

/** An `<em>`. */
defineProps<{ text: InlineTextProps["text"] }>();

useStandardStyles();
</script>

<template>
  <em>{{ text }}</em>
</template>
