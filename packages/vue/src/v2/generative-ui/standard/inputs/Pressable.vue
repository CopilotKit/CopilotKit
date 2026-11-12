<script setup lang="ts">
import { computed, ref, useTemplateRef } from "vue";
import {
  backgroundColor,
  borderColor as borderColorToken,
  defined,
  layoutStyle,
  openUrl,
} from "@copilotkit/shared/generative-ui";
import type { LayoutProps, StyleMap } from "@copilotkit/shared/generative-ui";
import { useGenerativeUIAccessibility } from "../../accessibility";
import { useStandardStyles } from "../../standard-styles";
import { provideContainerContext } from "../context";
import type { GenerativeUIEventProp } from "../context";
import { useVisibleOnce } from "../visible-once";

defineOptions({ name: "CopilotGenerativeUIPressable" });

/**
 * A clickable container. It is a `div` with the button role, not a
 * `<button>`, because it can hold other controls, and a button cannot.
 * Enter and Space on the container itself press it. A control inside it
 * sends only its own event.
 *
 * `ariaPressed` defaults to `undefined`, not `false`: only a toggle gets
 * `aria-pressed`.
 */
const props = withDefaults(
  defineProps<{
    align?: LayoutProps["align"];
    justify?: LayoutProps["justify"];
    wrap?: LayoutProps["wrap"];
    gap?: LayoutProps["gap"];
    rowGap?: LayoutProps["rowGap"];
    columnGap?: LayoutProps["columnGap"];
    padding?: LayoutProps["padding"];
    background?: LayoutProps["background"];
    border?: LayoutProps["border"];
    borderColor?: LayoutProps["borderColor"];
    radius?: LayoutProps["radius"];
    width?: LayoutProps["width"];
    height?: LayoutProps["height"];
    minWidth?: LayoutProps["minWidth"];
    maxWidth?: LayoutProps["maxWidth"];
    minHeight?: LayoutProps["minHeight"];
    maxHeight?: LayoutProps["maxHeight"];
    flex?: LayoutProps["flex"];
    weight?: LayoutProps["weight"];
    aspectRatio?: LayoutProps["aspectRatio"];
    scrollable?: LayoutProps["scrollable"];
    clip?: LayoutProps["clip"];
    shadow?: LayoutProps["shadow"];
    inline?: LayoutProps["inline"];
    role?: LayoutProps["role"];
    flush?: LayoutProps["flush"];
    minSize?: LayoutProps["minSize"];
    maxSize?: LayoutProps["maxSize"];
    disableAutoSpacing?: LayoutProps["disableAutoSpacing"];
    disabled?: boolean;
    /** The background token or CSS color while the pointer is over it. */
    hoverBackground?: string;
    /** Opens this URL in a new tab on click, instead of onClick. */
    href?: string;
    /** Shown on hover. */
    tooltip?: string;
    /** For a toggle: whether it is pressed. */
    ariaPressed?: boolean;
    /** A 1px border inside the box. */
    insetBorder?: boolean;
    /** Sent when the user clicks or presses the container. */
    onClick?: GenerativeUIEventProp;
    /** Sent once, the first time the container scrolls into view. */
    onVisible?: GenerativeUIEventProp;
  }>(),
  { ariaPressed: undefined },
);

defineSlots<{
  /** The content of the container. */
  children?: () => unknown;
}>();

useStandardStyles();
provideContainerContext();
const aria = useGenerativeUIAccessibility();
const root = useTemplateRef<HTMLDivElement>("root");
useVisibleOnce(root, () => props.onVisible);
const isHovered = ref(false);

const style = computed<StyleMap>(() => {
  const isDisabled = Boolean(props.disabled);
  const showHoverBackground =
    isHovered.value && props.hoverBackground !== undefined && !isDisabled;
  return defined({
    flexDirection: "column",
    ...layoutStyle(props),
    cursor: isDisabled ? "not-allowed" : "pointer",
    opacity: isDisabled ? 0.5 : undefined,
    boxShadow: props.insetBorder
      ? `inset 0 0 0 1px ${borderColorToken("default")}`
      : undefined,
    ...(showHoverBackground
      ? { background: backgroundColor(props.hoverBackground) }
      : {}),
  });
});

function press() {
  if (props.disabled) return;
  if (props.href) openUrl(props.href);
  else void props.onClick?.({});
}

function onKeyDown(event: KeyboardEvent) {
  // A key on a nested control (a Button, an input) belongs to it.
  if (event.target !== event.currentTarget) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  press();
}
</script>

<template>
  <div
    ref="root"
    role="button"
    :tabindex="disabled ? -1 : 0"
    :aria-disabled="disabled || undefined"
    :aria-pressed="ariaPressed"
    :title="tooltip"
    data-a2ui-input=""
    v-bind="aria"
    :style="style"
    @click.stop="press"
    @keydown="onKeyDown"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
  >
    <slot name="children" />
  </div>
</template>
