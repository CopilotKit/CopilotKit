<script setup lang="ts">
/**
 * React's `CopilotChatAssistantMessage.ToolbarButton`: an icon button named by
 * `label`, with the label as its tooltip. While the button's own popup is
 * open (`aria-expanded="true"`), the popup replaces the tooltip: an open
 * tooltip closes, and it does not reappear when the popup closes under a
 * pointer that left.
 *
 * @internal
 */
import { computed, mergeProps, useAttrs } from "vue";
import CopilotTooltip from "../ui/CopilotTooltip.vue";

defineOptions({ inheritAttrs: false });

defineProps<{ label: string }>();

defineSlots<{ default(): unknown; tooltip?(): unknown }>();

const attrs = useAttrs();
const popupOpen = computed(
  () => attrs["aria-expanded"] === true || attrs["aria-expanded"] === "true",
);

// Styles live in @copilotkit/core (ui/button.css, assistant-message.css).
const buttonClass =
  "cpk-button cpk-button-assistant-message-toolbar cpk-button-size-default";
</script>

<template>
  <CopilotTooltip :content="label" side="bottom" :suppressed="popupOpen">
    <template #default="{ triggerProps }">
      <button
        type="button"
        :class="buttonClass"
        :aria-label="label"
        v-bind="mergeProps(triggerProps, $attrs)"
      >
        <slot />
      </button>
    </template>
    <template v-if="$slots.tooltip" #content>
      <slot name="tooltip" />
    </template>
  </CopilotTooltip>
</template>
