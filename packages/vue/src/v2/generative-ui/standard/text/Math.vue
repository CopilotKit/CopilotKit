<script setup lang="ts">
import { computed } from "vue";
import { renderToString } from "katex";
import type { z } from "zod";
import type { mathSchema } from "@copilotkit/shared/generative-ui";
import { useKatexStyles } from "../../../hooks/use-katex-styles";
import { useStandardStyles } from "../../standard-styles";

defineOptions({ name: "CopilotGenerativeUIMath" });

type MathProps = z.output<typeof mathSchema>;

/**
 * A TeX formula, typeset with KaTeX: a `<span>`, or a centered `<div>` on
 * its own line when `block` is true. KaTeX escapes the source and adds
 * MathML for screen readers. With `trust: false`, commands that make links
 * or raw HTML do not work. An invalid formula shows as red source text, not
 * as an error.
 */
const props = defineProps<{
  /** The TeX source. */
  value: MathProps["value"];
  /** Default false. */
  block?: MathProps["block"];
}>();

useStandardStyles();
useKatexStyles();

const html = computed(() =>
  renderToString(props.value, {
    displayMode: props.block === true,
    throwOnError: false,
    trust: false,
  }),
);
</script>

<template>
  <!-- KaTeX escapes the source, so its HTML is safe to set. -->
  <div v-if="block" data-math="block" v-html="html" />
  <span v-else data-math="inline" v-html="html" />
</template>
