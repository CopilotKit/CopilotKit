<script setup lang="ts">
import { computed } from "vue";
import type { CSSProperties } from "vue";
import type { z } from "zod";
import { textColor } from "@copilotkit/shared/generative-ui";
import type { svgSchema } from "@copilotkit/shared/generative-ui";
import { useGenerativeUIAccessibility } from "../../accessibility";
import { useStandardStyles } from "../../standard-styles";
import { iconAria } from "./icons";

defineOptions({ name: "CopilotGenerativeUISvg" });

type SvgProps = z.output<typeof svgSchema>;

/**
 * A vector drawing from primitive shapes only. It has no raw markup, so the
 * model cannot add scripts or event handlers. A number size is pixels (not
 * 4px steps like the layout spacing). Colors take text color tokens or CSS
 * colors. Without a label, screen readers skip the drawing.
 */
const props = defineProps<{
  viewBox?: SvgProps["viewBox"];
  /** What the drawing shows, for screen readers. */
  label?: SvgProps["label"];
  /** Pixels when a number. Default "100%". */
  width?: SvgProps["width"];
  height?: SvgProps["height"];
  /** The width and height when they are not set. */
  size?: SvgProps["size"];
  /** The `currentColor` of the drawing. Default "prose". */
  color?: SvgProps["color"];
  /** Default `currentColor`. */
  fill?: SvgProps["fill"];
  stroke?: SvgProps["stroke"];
  strokeWidth?: SvgProps["strokeWidth"];
  strokeLinecap?: SvgProps["strokeLinecap"];
  strokeLinejoin?: SvgProps["strokeLinejoin"];
  preserveAspectRatio?: SvgProps["preserveAspectRatio"];
  paths?: SvgProps["paths"];
  circles?: SvgProps["circles"];
  rects?: SvgProps["rects"];
  lines?: SvgProps["lines"];
  texts?: SvgProps["texts"];
}>();

useStandardStyles();
const aria = useGenerativeUIAccessibility();
/** The envelope names the drawing like `label` does. */
const nameText = computed(() => aria.value["aria-label"] ?? props.label);
const style = computed<CSSProperties>(() => ({
  color: textColor(props.color ?? "prose"),
  display: "block",
}));
</script>

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    v-bind="iconAria(nameText, aria['aria-description'])"
    focusable="false"
    :viewBox="viewBox"
    :width="width ?? size ?? '100%'"
    :height="height ?? size"
    :fill="textColor(fill) ?? 'currentColor'"
    :stroke="textColor(stroke)"
    :stroke-width="strokeWidth"
    :stroke-linecap="strokeLinecap"
    :stroke-linejoin="strokeLinejoin"
    :preserveAspectRatio="preserveAspectRatio"
    :style="style"
  >
    <rect
      v-for="(rect, index) in rects ?? []"
      :key="`r${index}`"
      :x="rect.x"
      :y="rect.y"
      :width="rect.width"
      :height="rect.height"
      :rx="rect.rx"
      :fill="textColor(rect.fill)"
      :stroke="textColor(rect.stroke)"
    />
    <circle
      v-for="(circle, index) in circles ?? []"
      :key="`c${index}`"
      :cx="circle.cx"
      :cy="circle.cy"
      :r="circle.r"
      :fill="textColor(circle.fill)"
      :stroke="textColor(circle.stroke)"
    />
    <path
      v-for="(path, index) in paths ?? []"
      :key="`p${index}`"
      :d="path.d"
      :fill="textColor(path.fill)"
      :stroke="textColor(path.stroke)"
      :stroke-width="path.strokeWidth"
    />
    <line
      v-for="(line, index) in lines ?? []"
      :key="`l${index}`"
      :x1="line.x1"
      :y1="line.y1"
      :x2="line.x2"
      :y2="line.y2"
      :stroke="textColor(line.stroke) ?? 'currentColor'"
    />
    <text
      v-for="(text, index) in texts ?? []"
      :key="`t${index}`"
      :x="text.x"
      :y="text.y"
      :font-size="text.size"
      :fill="textColor(text.fill)"
      :text-anchor="text.anchor"
      stroke="none"
      v-text="text.text"
    />
  </svg>
</template>
