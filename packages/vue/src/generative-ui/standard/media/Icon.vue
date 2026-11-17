<script setup lang="ts">
import { computed } from "vue";
import type { CSSProperties } from "vue";
import type { z } from "zod";
import { textColor } from "@copilotkit/shared/generative-ui";
import type { iconSchema } from "@copilotkit/shared/generative-ui";
import { useGenerativeUIAccessibility } from "../../accessibility";
import { useStandardStyles } from "../../standard-styles";
import LucideIcon from "./LucideIcon.vue";
import { ICON_PX, iconAria, lucideNameOf } from "./icons";

defineOptions({ name: "CopilotGenerativeUIIcon" });

type IconProps = z.output<typeof iconSchema>;

/**
 * A Lucide icon by kebab-case name ("arrow-right"), an A2UI icon name
 * ("arrowBack"), or a `{ svgPath }` on a 24px grid. The Lucide icons load on
 * first use, in the browser. An unknown name renders nothing. Without a
 * label, screen readers skip the icon.
 */
const props = defineProps<{
  name: IconProps["name"];
  /** What the icon means, for screen readers. */
  label?: IconProps["label"];
  /** A named size or pixels. Default "md" (20px). */
  size?: IconProps["size"];
  color?: IconProps["color"];
  /** Sizes the icon to the text (1em) and aligns it with the text. */
  inline?: IconProps["inline"];
  /** The stroke width of a Lucide icon. */
  strokeWeight?: IconProps["strokeWeight"];
  weight?: IconProps["weight"];
}>();

useStandardStyles();
const aria = useGenerativeUIAccessibility();
/** The envelope names the icon like `label` does. */
const nameText = computed(() => aria.value["aria-label"] ?? props.label);
const flexStyle = computed<CSSProperties>(() => ({ flexGrow: props.weight }));
const pathPixels = computed(() => {
  const size = props.size ?? "md";
  if (typeof size === "number") return size;
  return props.inline ? "1em" : ICON_PX[size];
});
const pathStyle = computed<CSSProperties>(() => ({
  flexGrow: props.weight,
  flexShrink: 0,
  display: props.inline ? "inline-block" : "block",
  verticalAlign: props.inline ? "-0.125em" : undefined,
}));
</script>

<template>
  <svg
    v-if="typeof name === 'object'"
    v-bind="iconAria(nameText, aria['aria-description'])"
    focusable="false"
    viewBox="0 0 24 24"
    :width="pathPixels"
    :height="pathPixels"
    :fill="textColor(color) ?? 'currentColor'"
    :style="pathStyle"
  >
    <path :d="name.svgPath" />
  </svg>
  <LucideIcon
    v-else
    :name="lucideNameOf(name)"
    :label="nameText"
    :description="aria['aria-description']"
    :size="size"
    :color="color"
    :weight="strokeWeight"
    :inline="inline"
    :style="flexStyle"
  />
</template>
