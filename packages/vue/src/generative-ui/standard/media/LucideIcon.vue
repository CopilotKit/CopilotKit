<script setup lang="ts">
import { computed } from "vue";
import type { CSSProperties } from "vue";
import { textColor } from "@copilotkit/shared/generative-ui";
import type { IconSize, Weight } from "@copilotkit/shared/generative-ui";
import {
  ICON_PX,
  ICON_STROKE,
  iconAria,
  kebabToPascal,
  useLucideIcons,
} from "./icons";

defineOptions({ name: "CopilotGenerativeUILucideIcon" });

/**
 * A Lucide icon by kebab-case (or PascalCase) name. The icon set loads on
 * first use, in the browser. Until then, and for an unknown name, it
 * renders nothing. Without a `label`, screen readers skip the icon.
 *
 * @example
 * ```vue
 * <CopilotGenerativeUILucideIcon name="arrow-right" size="sm" />
 * ```
 */
const props = withDefaults(
  defineProps<{
    name: string;
    /** The name of the icon for screen readers. */
    label?: string;
    /** The description for screen readers. Used only with a `label`. */
    description?: string;
    /** A named size or pixels. Default "md" (20px). */
    size?: IconSize;
    /** A text color token or a CSS color. Default `currentColor`. */
    color?: string;
    /** The stroke width. */
    weight?: Weight;
    /** Sizes the icon to the text (1em) and aligns it with the text. */
    inline?: boolean;
  }>(),
  { size: "md" },
);

const icons = useLucideIcons();
const icon = computed(() => {
  const loaded = icons.value;
  if (!props.name || !loaded) return null;
  return loaded[kebabToPascal(props.name)] ?? loaded[props.name] ?? null;
});
const pixels = computed(() => {
  if (typeof props.size === "number") return props.size;
  return props.inline ? "1em" : ICON_PX[props.size];
});
const style = computed<CSSProperties>(() => ({
  flexShrink: 0,
  display: props.inline ? "inline-block" : "block",
  verticalAlign: props.inline ? "-0.125em" : undefined,
}));
</script>

<template>
  <component
    :is="icon"
    v-if="icon"
    v-bind="iconAria(label, description)"
    focusable="false"
    :width="pixels"
    :height="pixels"
    :color="textColor(color) ?? 'currentColor'"
    :strokeWidth="weight ? ICON_STROKE[weight] : undefined"
    :style="style"
  />
</template>
