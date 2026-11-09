<script setup lang="ts">
import { computed } from "vue";
import {
  defined,
  layoutStyle,
  spacing,
} from "@copilotkit/shared/generative-ui";
import type { LayoutProps, StyleMap } from "@copilotkit/shared/generative-ui";
import { useStandardStyles } from "../../standard-styles";
import { provideContainerContext } from "../context";
import type { GenerativeUIEventProp } from "../context";

defineOptions({ name: "CopilotGenerativeUIForm" });

/**
 * A layout container that is a form. It sends `onSubmit` when the user
 * submits it: a Button with `submit` inside it, or Enter in a field. The
 * browser checks the fields first (`required`, and the fields that a
 * control marks invalid), so a form with a wrong field does not submit.
 */
const props = defineProps<{
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
  /** A short name of the form for screen readers. */
  label?: string;
  /** Sent when the user submits the form. */
  onSubmit?: GenerativeUIEventProp;
}>();

defineSlots<{
  /** The fields and buttons of the form. */
  children?: () => unknown;
}>();

useStandardStyles();
provideContainerContext();

const style = computed<StyleMap>(() =>
  defined({
    flexDirection: "column",
    ...layoutStyle(props),
    gap: spacing(props.gap ?? 4),
  }),
);

function submitForm() {
  void props.onSubmit?.({});
}
</script>

<template>
  <form :aria-label="label" :style="style" @submit.prevent="submitForm">
    <slot name="children" />
  </form>
</template>
