<script setup lang="ts">
import { computed } from "vue";
import type { CSSProperties, VNode } from "vue";
import type { z } from "zod";
import {
  SHADOW_MD,
  backgroundColor,
  borderColor,
  px,
  radius,
  spacing,
} from "@copilotkit/shared/generative-ui";
import type { popoverContentSchema } from "@copilotkit/shared/generative-ui";
import { injectPopover } from "./popover-context";
import { useFeedbackStyles } from "./styles";

defineOptions({ name: "CopilotGenerativeUIPopoverContent" });

type PopoverContentProps = z.output<typeof popoverContentSchema>;
type Side = NonNullable<PopoverContentProps["side"]>;
type Align = NonNullable<PopoverContentProps["align"]>;

/**
 * The body of a Popover: a dialog labelled by the trigger, shown only while
 * the Popover is open. It sits on `side` of the trigger (default
 * "bottom"), `sideOffset` pixels away (default 6), aligned by `align`
 * (default "center"). Outside of a Popover, it is a plain panel that always
 * shows.
 */
const props = defineProps<{
  side?: PopoverContentProps["side"];
  sideOffset?: PopoverContentProps["sideOffset"];
  align?: PopoverContentProps["align"];
  width?: PopoverContentProps["width"];
}>();

defineSlots<{ children?: () => VNode[] }>();

useFeedbackStyles();
const popover = injectPopover();
const isOpen = computed(() => popover?.isOpen.value ?? false);

/** Where the content sits: on `side` of the trigger, `offset` pixels away. */
function sideStyle(side: Side, offset: number) {
  switch (side) {
    case "bottom":
      return { top: "100%", marginTop: px(offset) };
    case "top":
      return { bottom: "100%", marginBottom: px(offset) };
    case "left":
      return { right: "100%", marginRight: px(offset) };
    case "right":
      return { left: "100%", marginLeft: px(offset) };
  }
}

/** Where the content sits along the side of the trigger. */
function alignStyle(side: Side, align: Align) {
  const isVertical = side === "top" || side === "bottom";
  switch (align) {
    case "start":
      return isVertical ? { left: 0 } : { top: 0 };
    case "end":
      return isVertical ? { right: 0 } : { bottom: 0 };
    case "center":
      return isVertical
        ? { left: "50%", transform: "translateX(-50%)" }
        : { top: "50%", transform: "translateY(-50%)" };
  }
}

const PANEL_STYLE: CSSProperties = {
  zIndex: 50,
  minWidth: "160px",
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  gap: spacing(2),
  padding: spacing(3),
  background: backgroundColor("surface-elevated"),
  border: `1px solid ${borderColor("default")}`,
  borderRadius: radius("lg"),
  boxShadow: SHADOW_MD,
};

const panelStyle = computed(
  (): CSSProperties => ({
    ...PANEL_STYLE,
    position: "relative",
    width: spacing(props.width),
  }),
);

const openStyle = computed((): CSSProperties => {
  const side = props.side ?? "bottom";
  return {
    ...PANEL_STYLE,
    position: "absolute",
    ...sideStyle(side, props.sideOffset ?? 6),
    ...alignStyle(side, props.align ?? "center"),
    width: spacing(props.width),
  };
});
</script>

<template>
  <div v-if="!popover" data-a2ui-std="" :style="panelStyle">
    <slot name="children" />
  </div>
  <div
    v-else-if="isOpen"
    :id="popover.contentId"
    role="dialog"
    :aria-labelledby="popover.triggerId"
    data-a2ui-std=""
    :style="openStyle"
  >
    <slot name="children" />
  </div>
</template>
