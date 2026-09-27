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
    /**
     * `"pill"` (default) is a compact chip. `"card"` is a larger tile with the
     * label as a header and `description` as its body, used on welcome screens.
     */
    appearance?: "pill" | "card";
    /** Body text shown under the label when `appearance` is `"card"`. */
    description?: string;
  }>(),
  {
    icon: undefined,
    isLoading: false,
    disabled: false,
    type: "button",
    appearance: "pill",
    description: undefined,
  },
);

const isDisabled = computed(() => props.isLoading || props.disabled);

const pillClass =
  "cpk:group cpk:inline-flex cpk:h-8 cpk:items-center cpk:gap-1.5 cpk:rounded-full cpk:border cpk:border-input cpk:bg-card cpk:px-3.5 cpk:text-[13px] cpk:leading-none cpk:text-foreground/80 cpk:shadow-[0_1px_2px_0_rgb(0_0_0/0.03)] cpk:transition-colors cpk:cursor-pointer cpk:hover:bg-accent cpk:hover:text-foreground cpk:focus-visible:outline-none cpk:focus-visible:ring-2 cpk:focus-visible:ring-ring cpk:focus-visible:ring-offset-2 cpk:focus-visible:ring-offset-background cpk:disabled:cursor-not-allowed cpk:disabled:text-muted-foreground cpk:disabled:hover:bg-card cpk:disabled:hover:text-muted-foreground cpk:pointer-events-auto";

const cardClass =
  "cpk:group cpk:flex cpk:h-full cpk:w-full cpk:min-w-0 cpk:flex-col cpk:items-start cpk:gap-1 cpk:rounded-2xl cpk:border cpk:border-input cpk:bg-card cpk:px-3.5 cpk:py-3 cpk:text-left cpk:shadow-[0_1px_2px_0_rgb(0_0_0/0.03)] cpk:transition-colors cpk:cursor-pointer cpk:hover:bg-accent cpk:focus-visible:outline-none cpk:focus-visible:ring-2 cpk:focus-visible:ring-ring cpk:focus-visible:ring-offset-2 cpk:focus-visible:ring-offset-background cpk:disabled:cursor-not-allowed cpk:disabled:opacity-60 cpk:disabled:hover:bg-card cpk:pointer-events-auto";
</script>

<template>
  <button
    v-if="appearance === 'card'"
    data-copilotkit
    data-slot="suggestion-card"
    data-testid="copilot-chat-suggestion-pill"
    :type="type"
    :aria-busy="isLoading ? 'true' : undefined"
    :disabled="isDisabled"
    :class="cardClass"
    v-bind="$attrs"
  >
    <span
      class="cpk:flex cpk:w-full cpk:min-w-0 cpk:items-center cpk:gap-1.5 cpk:text-sm cpk:font-medium cpk:leading-snug cpk:text-foreground"
    >
      <IconLoader2
        v-if="isLoading"
        class="cpk:size-3.5 cpk:shrink-0 cpk:animate-spin cpk:text-muted-foreground"
        aria-hidden="true"
      />
      <span
        v-else-if="$slots.icon || icon"
        class="cpk:flex cpk:size-3.5 cpk:shrink-0 cpk:items-center cpk:justify-center cpk:text-muted-foreground"
      >
        <slot name="icon">
          <component :is="icon" />
        </slot>
      </span>
      <span class="cpk:truncate"><slot /></span>
    </span>
    <span
      v-if="description || $slots.description"
      class="cpk:line-clamp-2 cpk:text-[13px] cpk:leading-snug cpk:text-muted-foreground"
    >
      <slot name="description">{{ description }}</slot>
    </span>
  </button>
  <button
    v-else
    data-copilotkit
    data-slot="suggestion-pill"
    data-testid="copilot-chat-suggestion-pill"
    :type="type"
    :aria-busy="isLoading ? 'true' : undefined"
    :disabled="isDisabled"
    :class="pillClass"
    v-bind="$attrs"
  >
    <span
      v-if="isLoading"
      class="cpk:flex cpk:size-3.5 cpk:items-center cpk:justify-center cpk:text-muted-foreground"
    >
      <IconLoader2 class="cpk:size-3.5 cpk:animate-spin" aria-hidden="true" />
    </span>
    <span
      v-else-if="$slots.icon || icon"
      class="cpk:flex cpk:size-3.5 cpk:items-center cpk:justify-center cpk:text-muted-foreground"
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
