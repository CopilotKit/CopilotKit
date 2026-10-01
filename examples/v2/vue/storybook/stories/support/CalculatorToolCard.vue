<script setup lang="ts">
import { computed } from "vue";
import { Calculator } from "lucide-vue-next";
import ToolCard from "./ToolCard.vue";

/** Example `#tool-call-calculator` renderer; receives the slot props as-is. */
const props = defineProps<{
  args?: unknown;
  status: string;
  result?: string;
}>();

const expression = computed(
  () => ((props.args ?? {}) as { expression?: string }).expression,
);
</script>

<template>
  <ToolCard title="Calculator" :status="status">
    <template #icon><Calculator /></template>
    <div class="story-tool__equation">
      <span class="story-tool__expression">{{ expression ?? "…" }}</span>
      <span class="story-tool__answer">
        {{ status === "complete" ? `= ${result}` : "…" }}
      </span>
    </div>
  </ToolCard>
</template>
