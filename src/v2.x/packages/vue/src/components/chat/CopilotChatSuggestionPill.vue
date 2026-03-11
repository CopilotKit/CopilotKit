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
    data-slot="suggestion-pill"
    data-testid="copilot-chat-suggestion-pill"
    :type="type"
    :aria-busy="isLoading ? 'true' : undefined"
    :disabled="isDisabled"
    class="group inline-flex h-7 w-fit items-center gap-1 rounded-full border border-border/60 bg-background px-2.5 text-[11px] leading-none text-foreground transition-colors cursor-pointer hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:text-muted-foreground disabled:hover:bg-background disabled:hover:text-muted-foreground pointer-events-auto sm:h-8 sm:gap-1.5 sm:px-3 sm:text-xs"
    v-bind="$attrs"
  >
    <span
      v-if="isLoading"
      class="flex h-3.5 w-3.5 items-center justify-center text-muted-foreground sm:h-4 sm:w-4"
    >
      <IconLoader2 class="h-3.5 w-3.5 animate-spin sm:h-4 sm:w-4" aria-hidden="true" />
    </span>
    <span
      v-else-if="$slots.icon || icon"
      class="flex h-3.5 w-3.5 items-center justify-center text-muted-foreground sm:h-4 sm:w-4"
    >
      <slot name="icon">
        <component :is="icon" />
      </slot>
    </span>
    <span class="whitespace-nowrap font-medium leading-none">
      <slot />
    </span>
  </button>
</template>
