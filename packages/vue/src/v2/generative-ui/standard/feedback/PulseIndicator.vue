<script setup lang="ts">
import { computed } from "vue";
import type { CSSProperties } from "vue";
import type { z } from "zod";
import { px, textColor } from "@copilotkit/shared/generative-ui";
import type { pulseIndicatorSchema } from "@copilotkit/shared/generative-ui";
import { useFeedbackStyles } from "./styles";

defineOptions({ name: "CopilotGenerativeUIPulseIndicator" });

type PulseIndicatorProps = z.output<typeof pulseIndicatorSchema>;

/**
 * A small dot with a ring that pulses out of it. It is decoration: text
 * next to it names the status, or `label` names it for screen readers.
 * With a `label`, the dot is an image with that name. Without one, it is
 * hidden from screen readers.
 */
const props = defineProps<{
  label?: PulseIndicatorProps["label"];
  color?: PulseIndicatorProps["color"];
  size?: PulseIndicatorProps["size"];
  pulseColor?: PulseIndicatorProps["pulseColor"];
  duration?: PulseIndicatorProps["duration"];
  endScale?: PulseIndicatorProps["endScale"];
  startOpacity?: PulseIndicatorProps["startOpacity"];
}>();

useFeedbackStyles();

const hasLabel = computed(() => props.label !== undefined);
const dotColor = computed(() => textColor(props.color ?? "success"));

const rootStyle = computed((): CSSProperties => {
  const size = px(props.size ?? 12);
  return {
    position: "relative",
    display: "inline-block",
    width: size,
    height: size,
    flex: "none",
  };
});

const ringStyle = computed(
  (): CSSProperties => ({
    position: "absolute",
    inset: 0,
    borderRadius: "9999px",
    background: textColor(props.pulseColor) ?? dotColor.value,
    animation: `a2ui-pulse ${props.duration ?? 1500}ms ease-out infinite`,
    "--a2ui-pulse-scale": props.endScale,
    "--a2ui-pulse-opacity": props.startOpacity,
  }),
);

const dotStyle = computed(
  (): CSSProperties => ({
    position: "absolute",
    inset: 0,
    borderRadius: "9999px",
    background: dotColor.value,
  }),
);
</script>

<template>
  <span
    :role="hasLabel ? 'img' : undefined"
    :aria-label="label"
    :aria-hidden="hasLabel ? undefined : 'true'"
    data-a2ui-std=""
    :style="rootStyle"
  >
    <span data-a2ui-motion="" data-a2ui-pulse="" :style="ringStyle" />
    <span :style="dotStyle" />
  </span>
</template>
