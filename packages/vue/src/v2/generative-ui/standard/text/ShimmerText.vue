<script setup lang="ts">
import { computed } from "vue";
import type { CSSProperties } from "vue";
import type { z } from "zod";
import { textColor, textFont } from "@copilotkit/shared/generative-ui";
import type { shimmerSchema } from "@copilotkit/shared/generative-ui";
import { typographyStyle, useTextStyles } from "./typography";

defineOptions({ name: "CopilotGenerativeUIShimmerText" });

type ShimmerProps = z.output<typeof shimmerSchema>;

/**
 * Text with a moving shimmer. It shows that something is loading or
 * pending. The shimmer stops for reduced motion.
 */
const props = defineProps<{
  text: ShimmerProps["text"];
  size?: ShimmerProps["size"];
  lineThrough?: ShimmerProps["lineThrough"];
  /** Default "secondary". */
  color?: ShimmerProps["color"];
  fontWeight?: ShimmerProps["fontWeight"];
  textAlign?: ShimmerProps["textAlign"];
  italic?: ShimmerProps["italic"];
  truncate?: ShimmerProps["truncate"];
  maxLines?: ShimmerProps["maxLines"];
  tabularNums?: ShimmerProps["tabularNums"];
  width?: ShimmerProps["width"];
}>();

useTextStyles();

const style = computed<CSSProperties>(() => {
  const base = textColor(props.color ?? "secondary");
  return {
    ...(props.size ? textFont(props.size) : {}),
    margin: 0,
    ...typographyStyle(props),
    display: "inline-block",
    textDecoration: props.lineThrough ? "line-through" : undefined,
    backgroundImage: `linear-gradient(90deg, ${base} 0%, ${base} 40%, var(--a2ui-color-shimmer, #d9d9d9) 50%, ${base} 60%, ${base} 100%)`,
    backgroundSize: "200% 100%",
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
    animation: "a2ui-shimmer 1.5s linear infinite",
  };
});
</script>

<template>
  <span data-a2ui-shimmer="" :style="style">{{ text }}</span>
</template>
