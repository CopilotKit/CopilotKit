<script setup lang="ts">
import { computed } from "vue";
import type { CSSProperties, VNode } from "vue";
import type { z } from "zod";
import { FONT_WEIGHT, px, textFont } from "@copilotkit/shared/generative-ui";
import type { textSchema } from "@copilotkit/shared/generative-ui";
import { useGenerativeUIAccessibility } from "../../accessibility";
import { useStandardStyles } from "../../standard-styles";
import { InlineMarkdown } from "./inline-markdown";
import { typographyStyle } from "./typography";

defineOptions({ name: "CopilotGenerativeUIText" });

type TextProps = z.output<typeof textSchema>;

/**
 * A span of text with inline markdown, followed by its `children` inline.
 * Without a size it takes the size and line height of the host. It applies
 * the label and the description of the accessibility envelope itself.
 */
const props = defineProps<{
  /** Text with inline markdown. A number shows as text. */
  text?: TextProps["text"];
  /** The flex grow of the text in a Row. Default 0. */
  weight?: TextProps["weight"];
  size?: TextProps["size"];
  /** Pixels when a number. Wins over `size`. */
  fontSize?: TextProps["fontSize"];
  lineHeight?: TextProps["lineHeight"];
  /** Reserves the height of this many lines. */
  minLines?: TextProps["minLines"];
  strong?: TextProps["strong"];
  underline?: TextProps["underline"];
  lineThrough?: TextProps["lineThrough"];
  inline?: TextProps["inline"];
  preserveWhitespace?: TextProps["preserveWhitespace"];
  highlight?: TextProps["highlight"];
  color?: TextProps["color"];
  fontWeight?: TextProps["fontWeight"];
  textAlign?: TextProps["textAlign"];
  italic?: TextProps["italic"];
  truncate?: TextProps["truncate"];
  maxLines?: TextProps["maxLines"];
  tabularNums?: TextProps["tabularNums"];
  width?: TextProps["width"];
}>();

const slots = defineSlots<{
  /** The children, rendered inline after the text. */
  children?: () => VNode[];
}>();

useStandardStyles();
const aria = useGenerativeUIAccessibility();

const HIGHLIGHT = {
  green: "var(--a2ui-color-highlight-green, #d3f5e4)",
  orange: "var(--a2ui-color-highlight-orange, #ffe7c7)",
  pink: "var(--a2ui-color-highlight-pink, #fde0ef)",
};

const source = computed(() =>
  props.text === undefined ? "" : String(props.text),
);
const hasChildren = () => (slots.children?.() ?? []).length > 0;

const style = computed<CSSProperties>(() => {
  const highlight =
    props.highlight === true
      ? HIGHLIGHT.orange
      : props.highlight
        ? HIGHLIGHT[props.highlight]
        : undefined;
  const decoration = [
    props.underline ? "underline" : "",
    props.lineThrough ? "line-through" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const typography = typographyStyle(props);
  const fontWeight = props.fontWeight
    ? FONT_WEIGHT[props.fontWeight]
    : props.strong
      ? FONT_WEIGHT.semibold
      : undefined;
  return {
    display: props.inline ? "inline" : "block",
    // In a Row, text takes the width of its content, not 100%.
    flex: props.inline ? undefined : `${props.weight ?? 0} 1 auto`,
    minWidth: props.inline ? undefined : 0,
    // Without a size, text takes the size and line height of the host.
    ...(props.size ? textFont(props.size) : {}),
    ...(props.fontSize !== undefined ? { fontSize: px(props.fontSize) } : {}),
    ...(props.lineHeight !== undefined ? { lineHeight: props.lineHeight } : {}),
    minHeight: props.minLines ? `${props.minLines * 1.5}em` : undefined,
    margin: 0,
    ...typography,
    fontWeight,
    textDecoration: decoration || undefined,
    whiteSpace: props.preserveWhitespace ? "pre-wrap" : typography.whiteSpace,
    background: highlight,
  };
});
</script>

<template>
  <span data-a2ui-text="" data-a2ui-std="" v-bind="aria" :style="style"
    ><InlineMarkdown :text="source" /><template v-if="hasChildren()"
      ><template v-if="text">{{ " " }}</template
      ><slot name="children" /></template
  ></span>
</template>
