<script setup lang="ts">
import { computed } from "vue";

/**
 * Example app-defined tool card. It stands in for what a host app would render
 * from a `#tool-call-<name>` slot, so it uses the host's tokens rather than
 * CopilotKit's.
 */
const props = defineProps<{
  title: string;
  status: string;
}>();

const done = computed(() => props.status === "complete");
</script>

<template>
  <div class="story-tool">
    <div class="story-tool__head">
      <div class="story-tool__name">
        <span class="story-tool__icon"><slot name="icon" /></span>
        {{ title }}
      </div>
      <span class="story-tool__status">
        <span
          :class="['story-tool__dot', { 'story-tool__dot--running': !done }]"
        />
        {{ done ? "Done" : "Running" }}
      </span>
    </div>
    <div class="story-tool__body">
      <slot />
    </div>
  </div>
</template>
