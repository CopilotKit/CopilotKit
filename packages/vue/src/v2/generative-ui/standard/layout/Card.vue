<script setup lang="ts">
import { computed, ref } from "vue";
import { defined, layoutStyle } from "@copilotkit/shared/generative-ui";
import { namedRole, useGenerativeUIAccessibility } from "../../accessibility";
import { useStandardStyles } from "../../standard-styles";
import { provideCardContext, useCardNesting } from "../context";
import { useVisibleOnce } from "../visible-once";
import { cardStyle, scrollAttributes } from "./layout";
import type { CardProps, LayoutContainerProps } from "./layout";

defineOptions({ name: "CopilotGenerativeUICard" });

/**
 * A bordered, padded container. Its children are nested (distance 0): a
 * Card inside it draws no box. A section draws no box, so its content keeps
 * the nesting level of the Card around it. The `child` slot renders before
 * the `children` slot.
 */
const props = defineProps<
  LayoutContainerProps & {
    variant?: CardProps["variant"];
    shadowStyle?: CardProps["shadowStyle"];
    size?: CardProps["size"];
  }
>();

useStandardStyles();
const aria = useGenerativeUIAccessibility();
const nested = useCardNesting();
provideCardContext(() => (props.variant === "section" ? nested.value : true));
const root = ref<HTMLElement | null>(null);
useVisibleOnce(root, () => props.onVisible);

const attributes = computed(() => ({
  role: namedRole(aria.value, props.role),
  ...aria.value,
  "data-a2ui-std": "",
  "data-a2ui-card": nested.value ? "nested" : "top",
  "data-a2ui-card-variant": props.variant,
  ...scrollAttributes(props.scrollable),
  style: { ...layoutStyle(props), ...defined(cardStyle(props, nested.value)) },
}));
</script>

<template>
  <div ref="root" v-bind="attributes">
    <slot name="child" />
    <slot name="children" />
  </div>
</template>
