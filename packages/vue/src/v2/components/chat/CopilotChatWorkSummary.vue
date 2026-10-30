<script setup lang="ts">
/**
 * The line at the top of a reply in the `"turn"` tool-call display. While the
 * agent works it reads "Working 4s"; once the reply is done it reads "Worked
 * for 9s · 7 tools" and toggles the work it folded away.
 */
import { computed, ref, watch } from "vue";
import { IconChevronRight } from "../icons";
import type { CopilotChatWorkSummarySlotProps } from "./types";
import { pluralize } from "./tool-call-group-parts";
import { formatDuration } from "./turn-work";

// `onClick` falls through to the button.
const props = defineProps<Omit<CopilotChatWorkSummarySlotProps, "onClick">>();

// The current time, updated every second while the agent works.
const now = ref(Date.now());
watch(
  () => props.isWorking,
  (working, _previous, onCleanup) => {
    if (!working) return;
    now.value = Date.now();
    const timer = setInterval(() => {
      now.value = Date.now();
    }, 1000);
    onCleanup(() => clearInterval(timer));
  },
  { immediate: true },
);

const failed = computed(
  () => props.calls.filter((call) => call.toolMessage?.error).length,
);
const liveMs = computed(() =>
  props.elapsedMs !== undefined && props.workingSince !== undefined
    ? props.elapsedMs + Math.max(0, now.value - props.workingSince)
    : undefined,
);
// A finished reply worked for at least a second.
const duration = computed(() =>
  props.elapsedMs !== undefined
    ? formatDuration(Math.max(1000, props.elapsedMs))
    : undefined,
);
</script>

<template>
  <button
    type="button"
    data-copilotkit
    data-testid="copilot-work-summary"
    :data-state="isWorking ? 'working' : 'done'"
    :aria-expanded="isOpen ? 'true' : 'false'"
    class="cpk-work-summary"
  >
    <template v-if="isWorking">
      <span class="cpk-work-summary-label cpk-shimmer">Working</span>
      <span
        v-if="liveMs !== undefined"
        class="cpk-work-summary-detail cpk-work-summary-timer"
        >{{ formatDuration(liveMs) }}</span
      >
    </template>
    <template v-else>
      <span class="cpk-work-summary-label">{{
        duration
          ? `Worked for ${duration}`
          : `Used ${pluralize(calls.length, "tool")}`
      }}</span>
      <span v-if="duration" class="cpk-work-summary-detail">{{
        pluralize(calls.length, "tool")
      }}</span>
      <span v-if="failed > 0" class="cpk-work-summary-failed"
        >{{ failed }} failed</span
      >
    </template>
    <IconChevronRight
      aria-hidden="true"
      :class="[
        'cpk-work-summary-chevron',
        isOpen && 'cpk-work-summary-chevron-open',
      ]"
    />
  </button>
</template>
