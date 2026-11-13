<script lang="ts">
/** Makes the id of each tooltip unique in the page. */
</script>

<script setup lang="ts">
import { ref } from "vue";
import { useStandardId } from "../ids";
import type { CSSProperties, VNode } from "vue";
import {
  ON_ACCENT,
  SHADOW_MD,
  backgroundColor,
  radius,
  textFont,
} from "@copilotkit/shared/generative-ui";
import { useTextStyles } from "./typography";

defineOptions({ name: "CopilotGenerativeUITooltip" });

/**
 * Shows `content` while the pointer is over `trigger` or while `trigger`
 * has keyboard focus. Escape hides it. The trigger can take focus, and
 * screen readers read the content as its description. The tip is next to
 * the trigger (not in an overlay), so the description element is always
 * there for `aria-describedby`.
 */
defineSlots<{
  /** The element that shows the tip: a Text, Icon or Badge. */
  trigger?: () => VNode[];
  /** The short text of the tip. */
  content?: () => VNode[];
}>();

useTextStyles();

const id = `a2ui-tooltip-${useStandardId()}`;
const isOpen = ref(false);

// The wrapper hugs the trigger, so the tip centers on the trigger and not
// on a stretched flex item.
const WRAPPER_STYLE: CSSProperties = {
  position: "relative",
  display: "inline-flex",
  alignSelf: "flex-start",
  width: "max-content",
  maxWidth: "100%",
};
const TRIGGER_STYLE: CSSProperties = { display: "inline-flex" };
// The padding keeps the tooltip open while the pointer moves onto it.
const TOOLTIP_STYLE: CSSProperties = {
  position: "absolute",
  bottom: "100%",
  left: "50%",
  transform: "translateX(-50%)",
  paddingBottom: "6px",
  zIndex: 10,
};
const TIP_STYLE: CSSProperties = {
  display: "block",
  width: "max-content",
  maxWidth: "240px",
  padding: "4px 8px",
  borderRadius: radius("sm"),
  background: backgroundColor("surface-inverted"),
  color: ON_ACCENT,
  boxShadow: SHADOW_MD,
  ...textFont("xs"),
};

const open = () => {
  isOpen.value = true;
};
const close = () => {
  isOpen.value = false;
};

/**
 * Focus events of a control inside the trigger (a Button) bubble here, so
 * the tip follows focus inside the trigger too.
 */
function onFocusOut(event: FocusEvent) {
  const trigger = event.currentTarget;
  const next = event.relatedTarget;
  const isFocusInside =
    trigger instanceof Node && next instanceof Node && trigger.contains(next);
  if (!isFocusInside) close();
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === "Escape") close();
}
</script>

<template>
  <span :style="WRAPPER_STYLE" @mouseenter="open" @mouseleave="close">
    <span
      tabindex="0"
      data-a2ui-tooltip-trigger=""
      :aria-describedby="id"
      :style="TRIGGER_STYLE"
      @focusin="open"
      @focusout="onFocusOut"
      @keydown="onKeyDown"
      ><slot name="trigger"
    /></span>
    <span :id="id" role="tooltip" :hidden="!isOpen" :style="TOOLTIP_STYLE"
      ><span :style="TIP_STYLE"><slot name="content" /></span
    ></span>
  </span>
</template>
