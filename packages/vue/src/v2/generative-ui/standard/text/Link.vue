<script setup lang="ts">
import { computed } from "vue";
import type { CSSProperties } from "vue";
import type { z } from "zod";
import { safeHref, textColor } from "@copilotkit/shared/generative-ui";
import type { linkSchema } from "@copilotkit/shared/generative-ui";
import { useStandardStyles } from "../../standard-styles";
import { ExternalLink } from "./inline-markdown";

defineOptions({ name: "CopilotGenerativeUILink" });

type LinkProps = z.output<typeof linkSchema>;

/**
 * A link that opens in a new tab; screen readers also hear that. Only
 * http, https and mailto URLs make a link. With another URL, it is plain
 * text in a `<span>`.
 */
const props = defineProps<{
  /** The link text. The URL shows when it is empty. */
  text: LinkProps["text"];
  href: LinkProps["href"];
  title?: LinkProps["title"];
}>();

useStandardStyles();

const LINK_STYLE: CSSProperties = { color: textColor("info") };

const safe = computed(() => safeHref(props.href));
const label = computed(() => props.text || props.href);
</script>

<template>
  <ExternalLink v-if="safe" :href="safe" :title="title" :style="LINK_STYLE">{{
    label
  }}</ExternalLink>
  <span v-else :title="title">{{ label }}</span>
</template>
