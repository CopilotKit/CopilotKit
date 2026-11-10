<script setup lang="ts">
import type { z } from "zod";
import type { mathSchema } from "@copilotkit/shared/generative-ui";
import { useStandardStyles } from "../../standard-styles";

defineOptions({ name: "CopilotGenerativeUIMath" });

type MathProps = z.output<typeof mathSchema>;

/**
 * Shows the TeX source as code: a `<code>`, or a `<pre>` on its own line
 * when `block` is true. @copilotkit/vue ships no math typesetter, so a
 * formula reads as its source, which is still exact.
 */
defineProps<{
  /** The TeX source. */
  value: MathProps["value"];
  /** Default false. */
  block?: MathProps["block"];
}>();

useStandardStyles();
</script>

<template>
  <pre v-if="block" data-math="block"><code>{{ value }}</code></pre>
  <code v-else data-math="inline">{{ value }}</code>
</template>
