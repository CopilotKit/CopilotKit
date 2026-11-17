<script setup lang="ts">
import { computed } from "vue";
import type { CSSProperties } from "vue";
import type { z } from "zod";
import {
  backgroundColor,
  borderColor,
  faviconSrc,
  hostOf,
  radius,
} from "@copilotkit/shared/generative-ui";
import type { faviconSchema } from "@copilotkit/shared/generative-ui";
import { useStandardStyles } from "../../standard-styles";

defineOptions({ name: "CopilotGenerativeUIFavicon" });

type FaviconProps = z.output<typeof faviconSchema>;

/**
 * The favicon of the site at a URL, from Google's favicon service. The alt
 * text defaults to the host. A URL with no host renders nothing.
 */
const props = defineProps<{
  /** A URL, with or without a scheme. */
  url: FaviconProps["url"];
  alt?: FaviconProps["alt"];
  /** Pixels. Default 16. */
  size?: FaviconProps["size"];
  /** Aligns the icon with the text around it. */
  inline?: FaviconProps["inline"];
  /** A thin border and padding around the icon. */
  frame?: FaviconProps["frame"];
}>();

useStandardStyles();
const host = computed(() => hostOf(props.url));
const style = computed<CSSProperties>(() => ({
  display: props.inline ? "inline-block" : "block",
  verticalAlign: props.inline ? "middle" : undefined,
  borderRadius: radius("xs"),
  border: props.frame ? `1px solid ${borderColor("default")}` : undefined,
  padding: props.frame ? "2px" : undefined,
  background: props.frame ? backgroundColor("surface") : undefined,
}));
</script>

<template>
  <img
    v-if="host"
    :src="faviconSrc(host)"
    :alt="alt ?? host"
    :width="size ?? 16"
    :height="size ?? 16"
    :style="style"
  />
</template>
