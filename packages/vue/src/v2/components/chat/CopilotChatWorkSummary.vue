<script setup lang="ts">
/**
 * The line at the top of a reply in the `"turn"` tool-call display. While the
 * agent works it reads "Working 4s"; once the reply is done it reads "Worked
 * for 9s · 7 tools" and toggles the work it folded away.
 */
import { computed, ref, watch } from "vue";
import { ɵgetWorkSummaryText } from "@copilotkit/core";
import { IconChevronRight } from "../icons";
import type { CopilotChatWorkSummarySlotProps } from "./types";
import { useChatLabels } from "./use-chat-labels";

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

const labels = useChatLabels();
const text = computed(() =>
  ɵgetWorkSummaryText({
    isWorking: props.isWorking,
    calls: props.calls,
    elapsedMs: props.elapsedMs,
    workingSince: props.workingSince,
    now: now.value,
    labels: labels.value,
  }),
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
    <span :class="['cpk-work-summary-label', isWorking && 'cpk-shimmer']">{{
      text.label
    }}</span>
    <span
      v-if="text.detail !== null"
      :class="[
        'cpk-work-summary-detail',
        isWorking && 'cpk-work-summary-timer',
      ]"
      >{{ text.detail }}</span
    >
    <span v-if="text.failed !== null" class="cpk-work-summary-failed">{{
      text.failed
    }}</span>
    <IconChevronRight
      aria-hidden="true"
      :class="[
        'cpk-work-summary-chevron',
        isOpen && 'cpk-work-summary-chevron-open',
      ]"
    />
  </button>
</template>
