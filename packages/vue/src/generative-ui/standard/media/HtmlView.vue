<script setup lang="ts">
import { computed } from "vue";
import type { CSSProperties } from "vue";
import type { z } from "zod";
import {
  backgroundColor,
  borderColor,
  px,
  radius,
} from "@copilotkit/shared/generative-ui";
import type { htmlViewSchema } from "@copilotkit/shared/generative-ui";
import { useStandardStyles } from "../../standard-styles";

defineOptions({ name: "CopilotGenerativeUIHtmlView" });

type HtmlViewProps = z.output<typeof htmlViewSchema>;

/**
 * Raw HTML in a fully sandboxed iframe. The empty `sandbox` is the
 * protection: no scripts, no same origin, no forms, no popups. So the HTML
 * is set as the model sent it.
 */
const props = defineProps<{
  html: HtmlViewProps["html"];
  /** Pixels when a number. Default 360. */
  height?: HtmlViewProps["height"];
  /** Pixels when a number. Default "100%". */
  width?: HtmlViewProps["width"];
  /** Names the content for screen readers. Default "HTML content". */
  title?: HtmlViewProps["title"];
}>();

useStandardStyles();
const style = computed<CSSProperties>(() => ({
  display: "block",
  border: `1px solid ${borderColor("default")}`,
  borderRadius: radius("md"),
  height: px(props.height ?? 360),
  width: px(props.width ?? "100%"),
  background: backgroundColor("surface"),
}));
</script>

<template>
  <iframe
    sandbox=""
    :srcdoc="html"
    :title="title ?? 'HTML content'"
    :style="style"
  />
</template>
