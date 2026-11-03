<script setup lang="ts">
/**
 * The line at the top of a reply in the `"turn"` tool-call display. While the
 * agent works it reads "Working 4s"; once the reply is done it reads "Worked
 * for 9s · 7 tools" and toggles the work it folded away.
 */
import { computed, ref, watch } from "vue";
import {
  ɵcountFailedToolCalls,
  ɵformatLabel,
  ɵformatWorkDuration,
  ɵformatCountLabel,
} from "@copilotkit/core";
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
const failed = computed(() => ɵcountFailedToolCalls(props.calls));
const liveMs = computed(() =>
  props.elapsedMs !== undefined && props.workingSince !== undefined
    ? props.elapsedMs + Math.max(0, now.value - props.workingSince)
    : undefined,
);
// A finished reply worked for at least a second.
const duration = computed(() =>
  props.elapsedMs !== undefined
    ? ɵformatWorkDuration(Math.max(1000, props.elapsedMs))
    : undefined,
);
const toolCount = computed(() =>
  ɵformatCountLabel(props.calls.length, {
    one: labels.value.toolCallToolCountOne,
    other: labels.value.toolCallToolCountOther,
  }),
);
const doneLabel = computed(() =>
  duration.value
    ? ɵformatLabel(labels.value.workSummaryWorkedForLabel, {
        duration: duration.value,
      })
    : ɵformatCountLabel(props.calls.length, {
        one: labels.value.toolCallUsedToolsOne,
        other: labels.value.toolCallUsedToolsOther,
      }),
);
const liveDuration = computed(() =>
  liveMs.value !== undefined ? ɵformatWorkDuration(liveMs.value) : undefined,
);
const failedLabel = computed(() =>
  ɵformatLabel(labels.value.toolCallFailedCountLabel, {
    count: failed.value,
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
    <template v-if="isWorking">
      <span class="cpk-work-summary-label cpk-shimmer">{{
        labels.workSummaryWorkingLabel
      }}</span>
      <span
        v-if="liveDuration !== undefined"
        class="cpk-work-summary-detail cpk-work-summary-timer"
        >{{ liveDuration }}</span
      >
    </template>
    <template v-else>
      <span class="cpk-work-summary-label">{{ doneLabel }}</span>
      <span v-if="duration" class="cpk-work-summary-detail">{{
        toolCount
      }}</span>
      <span v-if="failed > 0" class="cpk-work-summary-failed">{{
        failedLabel
      }}</span>
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
