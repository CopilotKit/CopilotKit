<script setup lang="ts">
import { computed } from "vue";
import type { CSSProperties } from "vue";
import type { z } from "zod";
import {
  FONT_WEIGHT,
  ON_ACCENT,
  backgroundColor,
  borderColor,
  radius,
  spacing,
  textColor,
} from "@copilotkit/shared/generative-ui";
import type {
  BADGE_SIZES,
  badgeSchema,
} from "@copilotkit/shared/generative-ui";
import { useStandardStyles } from "../../standard-styles";

defineOptions({ name: "CopilotGenerativeUIBadge" });

type BadgeProps = z.output<typeof badgeSchema>;
type BadgeSize = (typeof BADGE_SIZES)[number];

/** A small status pill: soft, solid or outlined, a pill unless `pill` is false. */
const props = defineProps<{
  label: BadgeProps["label"];
  /** Default "secondary". */
  color?: BadgeProps["color"];
  /** Default "md". */
  size?: BadgeProps["size"];
  /** Default true. False gives small rounded corners. */
  pill?: BadgeProps["pill"];
  /** Default "soft". */
  variant?: BadgeProps["variant"];
  /** Default "medium". */
  fontWeight?: BadgeProps["fontWeight"];
  maxWidth?: BadgeProps["maxWidth"];
  padding?: BadgeProps["padding"];
}>();

useStandardStyles();

/** Badge "md": a 20px pill, 12px text with weight 500 and 0.3px tracking. */
const BADGE_PAD: Record<BadgeSize, string> = {
  sm: "0 5px",
  md: "0 6.65px",
  lg: "2px 8px",
};
const BADGE_FONT: Record<BadgeSize, string> = {
  sm: ".6875em",
  md: ".75em",
  lg: ".8125em",
};
const BADGE_HEIGHT: Record<BadgeSize, string> = {
  sm: "18px",
  md: "20px",
  lg: "24px",
};
const BADGE_NEUTRAL_BG =
  "var(--a2ui-color-badge-secondary, rgba(0, 0, 0, 0.05))";

/** The fill of a badge: solid, none (outline), or a soft tint. */
function badgeBackground(color: string, variant: string) {
  const isNeutral = color === "secondary";
  switch (variant) {
    case "solid":
      return backgroundColor(isNeutral ? "surface-inverted" : `${color}-solid`);
    case "outline":
      return "transparent";
    default:
      return isNeutral ? BADGE_NEUTRAL_BG : backgroundColor(color);
  }
}

const style = computed<CSSProperties>(() => {
  const color = props.color ?? "secondary";
  const variant = props.variant ?? "soft";
  const size = props.size ?? "md";
  const isNeutral = color === "secondary";
  const ink = textColor(isNeutral ? "default" : color);
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    flexShrink: 0,
    boxSizing: "border-box",
    minHeight: BADGE_HEIGHT[size],
    verticalAlign: "middle",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: spacing(props.maxWidth),
    padding:
      props.padding !== undefined ? spacing(props.padding) : BADGE_PAD[size],
    fontSize: BADGE_FONT[size],
    lineHeight: "16px",
    letterSpacing: "0.3px",
    fontWeight: FONT_WEIGHT[props.fontWeight ?? "medium"],
    borderRadius: props.pill === false ? radius("sm") : radius("full"),
    background: badgeBackground(color, variant),
    color: variant === "solid" ? ON_ACCENT : ink,
    border:
      variant === "outline"
        ? `1px solid ${borderColor(isNeutral ? "default" : color)}`
        : undefined,
  };
});
</script>

<template>
  <span :style="style">{{ label }}</span>
</template>
