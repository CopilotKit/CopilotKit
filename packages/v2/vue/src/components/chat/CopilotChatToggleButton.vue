<script setup lang="ts">
import { computed, ref, useAttrs } from "vue";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";
import { CopilotChatDefaultLabels } from "../../providers/types";
import CopilotChatToggleButtonCloseIcon from "./CopilotChatToggleButtonCloseIcon";
import CopilotChatToggleButtonOpenIcon from "./CopilotChatToggleButtonOpenIcon";
import type {
  CopilotChatToggleButtonIconSlotProps,
  CopilotChatToggleButtonProps,
} from "./types";

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<CopilotChatToggleButtonProps>(), {
  disabled: false,
  type: "button",
});

defineSlots<{
  "open-icon"?: (props: CopilotChatToggleButtonIconSlotProps) => unknown;
  "close-icon"?: (props: CopilotChatToggleButtonIconSlotProps) => unknown;
}>();

const attrs = useAttrs();
const config = useCopilotChatConfiguration();
const fallbackOpen = ref(false);

const labels = computed(() => config.value?.labels ?? CopilotChatDefaultLabels);
const isOpen = computed(() => config.value?.isModalOpen ?? fallbackOpen.value);
const ariaLabel = computed(() =>
  isOpen.value ? labels.value.chatToggleCloseLabel : labels.value.chatToggleOpenLabel,
);
const buttonClass = computed(() => [
  "fixed bottom-6 right-6 z-[1100] flex h-14 w-14 items-center justify-center",
  "rounded-full border border-primary bg-primary text-primary-foreground",
  "shadow-sm transition-all duration-200 ease-out",
  "hover:scale-[1.04] hover:shadow-md cursor-pointer active:scale-[0.96]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  "disabled:pointer-events-none disabled:opacity-60",
  attrs.class,
]);
const buttonAttrs = computed(() => {
  const { class: _className, onClick: _onClick, ...rest } = attrs;
  return rest;
});

const iconClass = "h-6 w-6";
const iconTransitionStyle = Object.freeze({
  transition: "opacity 120ms ease-out, transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
});
const iconWrapperBase =
  "pointer-events-none absolute inset-0 flex items-center justify-center will-change-transform";

function setModalOpen(open: boolean) {
  if (config.value?.setModalOpen) {
    config.value.setModalOpen(open);
    return;
  }
  fallbackOpen.value = open;
}

function getClickListeners() {
  const listener = attrs.onClick;
  if (Array.isArray(listener)) {
    return listener.filter((item): item is (event: MouseEvent) => void => typeof item === "function");
  }
  return typeof listener === "function" ? [listener as (event: MouseEvent) => void] : [];
}

function handleClick(event: MouseEvent) {
  if (props.disabled) {
    return;
  }

  for (const listener of getClickListeners()) {
    listener(event);
  }

  if (event.defaultPrevented) {
    return;
  }

  setModalOpen(!isOpen.value);
}
</script>

<template>
  <button
    :type="type"
    data-slot="chat-toggle-button"
    :data-state="isOpen ? 'open' : 'closed'"
    :class="buttonClass"
    :aria-label="ariaLabel"
    :aria-pressed="isOpen"
    :disabled="disabled"
    v-bind="buttonAttrs"
    @click="handleClick"
  >
    <span
      aria-hidden="true"
      data-slot="chat-toggle-button-open-icon"
      :class="iconWrapperBase"
      :style="{
        ...iconTransitionStyle,
        opacity: isOpen ? 0 : 1,
        transform: `scale(${isOpen ? 0.75 : 1}) rotate(${isOpen ? 90 : 0}deg)`,
      }"
    >
      <slot name="open-icon" :icon-class="iconClass" :is-open="isOpen">
        <CopilotChatToggleButtonOpenIcon
          :class="iconClass"
          aria-hidden="true"
          :focusable="false"
        />
      </slot>
    </span>

    <span
      aria-hidden="true"
      data-slot="chat-toggle-button-close-icon"
      :class="iconWrapperBase"
      :style="{
        ...iconTransitionStyle,
        opacity: isOpen ? 1 : 0,
        transform: `scale(${isOpen ? 1 : 0.75}) rotate(${isOpen ? 0 : -90}deg)`,
      }"
    >
      <slot name="close-icon" :icon-class="iconClass" :is-open="isOpen">
        <CopilotChatToggleButtonCloseIcon
          :class="iconClass"
          aria-hidden="true"
          :focusable="false"
        />
      </slot>
    </span>
  </button>
</template>
