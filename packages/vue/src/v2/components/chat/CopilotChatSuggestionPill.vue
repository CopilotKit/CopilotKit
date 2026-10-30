<script setup lang="ts">
import type { Component } from "vue";
import { computed } from "vue";
import { IconLoader2 } from "../icons";

const props = withDefaults(
  defineProps<{
    icon?: Component;
    isLoading?: boolean;
    disabled?: boolean;
    type?: "button" | "submit" | "reset";
  }>(),
  {
    icon: undefined,
    isLoading: false,
    disabled: false,
    type: "button",
  },
);

const isDisabled = computed(() => props.isLoading || props.disabled);
</script>

<template>
  <button
    data-copilotkit
    data-slot="suggestion-pill"
    data-testid="copilot-chat-suggestion-pill"
    :type="type"
    :aria-busy="isLoading ? 'true' : undefined"
    :disabled="isDisabled"
    class="cpk-suggestion-pill"
    v-bind="$attrs"
  >
    <span v-if="isLoading" class="cpk-suggestion-pill-icon">
      <IconLoader2 class="cpk-suggestion-pill-spinner" aria-hidden="true" />
    </span>
    <span v-else-if="$slots.icon || icon" class="cpk-suggestion-pill-icon">
      <slot name="icon">
        <component :is="icon" />
      </slot>
    </span>
    <span class="cpk-suggestion-pill-label">
      <slot />
    </span>
  </button>
</template>
