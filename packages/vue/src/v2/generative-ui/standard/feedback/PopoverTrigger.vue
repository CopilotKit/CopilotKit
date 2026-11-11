<script setup lang="ts">
import { computed } from "vue";
import type { ComponentPublicInstance, CSSProperties, VNode } from "vue";
import type { z } from "zod";
import { radius } from "@copilotkit/shared/generative-ui";
import type { popoverTriggerSchema } from "@copilotkit/shared/generative-ui";
import { controlAria, useGenerativeUIAccessibility } from "../../accessibility";
import { injectPopover } from "./popover-context";
import { BUTTON_RESET, useFeedbackStyles } from "./styles";

defineOptions({ name: "CopilotGenerativeUIPopoverTrigger" });

type PopoverTriggerProps = z.output<typeof popoverTriggerSchema>;

/**
 * The trigger of a Popover: a native button around its children, which
 * toggles the Popover. The envelope `label` names it. Outside of a
 * Popover, it renders its children only.
 */
const props = defineProps<{ block?: PopoverTriggerProps["block"] }>();

defineSlots<{ children?: () => VNode[] }>();

const aria = useGenerativeUIAccessibility();
useFeedbackStyles();
const popover = injectPopover();

const controlAttributes = computed(() => controlAria(aria.value));
const isOpen = computed(() => popover?.isOpen.value ?? false);

const style = computed(
  (): CSSProperties => ({
    ...BUTTON_RESET,
    display: props.block ? "flex" : "inline-flex",
    width: props.block ? "100%" : undefined,
    alignItems: "center",
    minWidth: "24px",
    minHeight: "24px",
    borderRadius: radius("xs"),
  }),
);

function setTrigger(element: Element | ComponentPublicInstance | null) {
  if (!popover) return;
  popover.triggerElement.value =
    element instanceof HTMLElement ? element : null;
}

// The capture phase: a Button child stops the propagation of its own click
// (so it never bubbles into a Pressable), which would leave the trigger
// without the click.
function toggle() {
  popover?.setOpen(!isOpen.value);
}
</script>

<template>
  <slot v-if="!popover" name="children" />
  <button
    v-else
    v-bind="controlAttributes"
    :id="popover.triggerId"
    :ref="setTrigger"
    type="button"
    aria-haspopup="dialog"
    :aria-expanded="isOpen"
    :aria-controls="isOpen ? popover.contentId : undefined"
    data-a2ui-std=""
    data-a2ui-feedback-button=""
    data-a2ui-popover-trigger=""
    :style="style"
    @click.capture="toggle"
  >
    <slot name="children" />
  </button>
</template>
