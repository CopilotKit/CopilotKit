<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from "vue";
import type { CSSProperties } from "vue";
import type { z } from "zod";
import {
  FONT_WEIGHT,
  SHADOW_MD,
  backgroundColor,
  borderColor,
  faviconSrc,
  hostOf,
  radius,
  safeHref,
  spacing,
  textColor,
  textFont,
} from "@copilotkit/shared/generative-ui";
import type { citationSchema } from "@copilotkit/shared/generative-ui";
import { useStandardStyles } from "../../standard-styles";
import { FAVICON_STYLE, SECONDARY_SM, SECONDARY_XS } from "./styles";

defineOptions({ name: "CopilotGenerativeUICitation" });

type CitationProps = z.output<typeof citationSchema>;

/**
 * An inline source marker that shows the source on hover or click: its
 * domain, title, snippet and an "Open source" link. A mousedown outside
 * closes it. The panel sits in the flow, positioned against the marker.
 */
const props = defineProps<{
  /** The marker number. Default 1. */
  index?: CitationProps["index"];
  /** Marker text instead of the number. */
  label?: CitationProps["label"];
  title?: CitationProps["title"];
  /** The source URL. Only http, https and mailto become a link. */
  url?: CitationProps["url"];
  /** The quoted passage. */
  snippet?: CitationProps["snippet"];
  /** The publisher or domain. Default: the host of `url`. */
  source?: CitationProps["source"];
}>();

useStandardStyles();

const isOpen = ref(false);
const rootElement = useTemplateRef<HTMLSpanElement>("rootElement");

// While open, a mousedown outside the citation closes it. The watcher runs
// in the browser only: `isOpen` starts false and changes on user input.
watch(isOpen, (open, _previous, onCleanup) => {
  if (!open || typeof document === "undefined") return;
  const onDown = (event: MouseEvent) => {
    const root = rootElement.value;
    const isOutside =
      root !== null &&
      event.target instanceof Node &&
      !root.contains(event.target);
    if (isOutside) isOpen.value = false;
  };
  document.addEventListener("mousedown", onDown);
  onCleanup(() => document.removeEventListener("mousedown", onDown));
});

const safeUrl = computed(() => (props.url ? safeHref(props.url) : undefined));
const host = computed(() =>
  safeUrl.value ? hostOf(safeUrl.value) : undefined,
);
const shownSource = computed(() => props.source || host.value || "");
const marker = computed(() => props.label || String(props.index ?? 1));

const ROOT_STYLE: CSSProperties = {
  position: "relative",
  display: "inline-flex",
  verticalAlign: "baseline",
};
const MARKER_STYLE: CSSProperties = {
  font: "inherit",
  fontSize: ".75em",
  lineHeight: 1,
  fontWeight: FONT_WEIGHT.medium,
  padding: "2px 6px",
  margin: "0 2px",
  borderRadius: "9999px",
  border: "none",
  background: backgroundColor("surface-secondary"),
  color: textColor("secondary"),
  cursor: "pointer",
  verticalAlign: "super",
};
const PANEL_STYLE: CSSProperties = {
  position: "absolute",
  top: "100%",
  left: 0,
  zIndex: 50,
  marginTop: "6px",
  width: "280px",
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  padding: spacing(3),
  background: backgroundColor("surface-elevated"),
  border: `1px solid ${borderColor("default")}`,
  borderRadius: radius("lg"),
  boxShadow: SHADOW_MD,
  textAlign: "start",
};
const SOURCE_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  ...SECONDARY_XS,
};
const TITLE_STYLE: CSSProperties = {
  ...textFont("sm"),
  fontWeight: FONT_WEIGHT.medium,
  color: textColor("default"),
};
const OPEN_STYLE: CSSProperties = {
  ...textFont("xs"),
  color: textColor("info"),
};
</script>

<template>
  <span
    ref="rootElement"
    data-a2ui-citation=""
    :style="ROOT_STYLE"
    @mouseenter="isOpen = true"
    @mouseleave="isOpen = false"
  >
    <button
      type="button"
      :aria-expanded="isOpen"
      :aria-label="`Source ${marker}`"
      data-a2ui-input=""
      :style="MARKER_STYLE"
      @click.stop="isOpen = !isOpen"
    >
      {{ marker }}
    </button>
    <span v-if="isOpen" role="dialog" :style="PANEL_STYLE">
      <span v-if="shownSource" :style="SOURCE_STYLE">
        <img
          v-if="host"
          :src="faviconSrc(host)"
          alt=""
          width="16"
          height="16"
          :style="FAVICON_STYLE"
        />
        {{ shownSource }}
      </span>
      <span v-if="title" :style="TITLE_STYLE">{{ title }}</span>
      <span v-if="snippet" :style="SECONDARY_SM">{{ snippet }}</span>
      <a
        v-if="safeUrl"
        :href="safeUrl"
        target="_blank"
        rel="noopener noreferrer"
        :style="OPEN_STYLE"
        >Open source</a
      >
    </span>
  </span>
</template>
