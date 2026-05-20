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
    class="cpk:group cpk:inline-flex cpk:h-7 cpk:w-fit cpk:items-center cpk:gap-1 cpk:rounded-full cpk:border cpk:border-border/60 cpk:bg-background cpk:px-2.5 cpk:text-[11px] cpk:leading-none cpk:text-foreground cpk:transition-colors cpk:cursor-pointer cpk:hover:bg-accent/60 cpk:hover:text-foreground cpk:focus-visible:outline-none cpk:focus-visible:ring-2 cpk:focus-visible:ring-ring cpk:focus-visible:ring-offset-2 cpk:focus-visible:ring-offset-background cpk:disabled:cursor-not-allowed cpk:disabled:text-muted-foreground cpk:disabled:hover:bg-background cpk:disabled:hover:text-muted-foreground cpk:pointer-events-auto cpk:sm:h-8 cpk:sm:gap-1.5 cpk:sm:px-3 cpk:sm:text-xs"
    v-bind="$attrs"
  >
    <span
      v-if="isLoading"
      class="cpk:flex cpk:h-3.5 cpk:w-3.5 cpk:items-center cpk:justify-center cpk:text-muted-foreground cpk:sm:h-4 cpk:sm:w-4"
    >
      <IconLoader2
        class="cpk:h-3.5 cpk:w-3.5 cpk:animate-spin cpk:sm:h-4 cpk:sm:w-4"
        aria-hidden="true"
      />
    </span>
    <span
      v-else-if="$slots.icon || icon"
      class="cpk:flex cpk:h-3.5 cpk:w-3.5 cpk:items-center cpk:justify-center cpk:text-muted-foreground cpk:sm:h-4 cpk:sm:w-4"
    >
      <slot name="icon">
        <component :is="icon" />
      </slot>
    </span>
    <span class="cpk:whitespace-nowrap cpk:font-medium cpk:leading-none">
      <slot />
    </span>
  </button>
</template>
