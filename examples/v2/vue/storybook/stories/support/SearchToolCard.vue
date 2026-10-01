<script setup lang="ts">
import { computed } from "vue";
import { Search } from "lucide-vue-next";
import ToolCard from "./ToolCard.vue";

/** Example `#tool-call-search` renderer; receives the slot props as-is. */
const props = defineProps<{
  args?: unknown;
  status: string;
  result?: string;
}>();

const search = computed(
  () => (props.args ?? {}) as { query?: string; filters?: string[] },
);
</script>

<template>
  <ToolCard title="Search" :status="status">
    <template #icon><Search /></template>
    <p class="story-tool__muted">
      Query: <span class="story-tool__strong">{{ search.query ?? "…" }}</span>
    </p>
    <div v-if="search.filters?.length" class="story-tool__chips">
      <span v-for="filter in search.filters" :key="filter" class="host-badge">
        {{ filter }}
      </span>
    </div>
    <p v-if="status === 'complete'" class="story-tool__result">{{ result }}</p>
  </ToolCard>
</template>
