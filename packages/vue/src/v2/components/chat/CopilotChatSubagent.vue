<script setup lang="ts">
import { computed, ref } from "vue";
import type { Message } from "@ag-ui/core";
import type { Subagent, SubagentStatus } from "@copilotkit/core";

/**
 * The default group for one subagent's work in the chat. It is open while the
 * subagent runs, fails or waits, and collapses to its header when it is done.
 * A click on the header opens or closes it until the status changes again.
 *
 * Replace it with the `#subagent` slot on `CopilotChatMessageView`.
 */
const props = defineProps<{
  /** The invocation this group shows. */
  subagentRunId: string;
  /** What the agent announced; undefined when it only attributed messages. */
  subagent?: Subagent;
  /** The subagent's own messages, in order. */
  messages: Message[];
}>();

defineSlots<{
  /** The rendered messages, and any nested subagent groups. */
  default?: () => unknown;
}>();

const statusLabel: Record<SubagentStatus, string> = {
  running: "Running",
  done: "Done",
  suspended: "Waiting",
  error: "Failed",
};

const statusClass: Record<SubagentStatus, string> = {
  running:
    "cpk:bg-amber-100 cpk:text-amber-800 cpk:dark:bg-amber-500/15 cpk:dark:text-amber-400",
  done: "cpk:bg-emerald-100 cpk:text-emerald-800 cpk:dark:bg-emerald-500/15 cpk:dark:text-emerald-400",
  suspended:
    "cpk:bg-sky-100 cpk:text-sky-800 cpk:dark:bg-sky-500/15 cpk:dark:text-sky-400",
  error:
    "cpk:bg-red-100 cpk:text-red-800 cpk:dark:bg-red-500/15 cpk:dark:text-red-400",
};

const status = computed(() => props.subagent?.status);
// The user's choice holds only for the status it was made in, so a group the
// user opened still collapses when that subagent later finishes.
const choice = ref<{
  status: SubagentStatus | undefined;
  open: boolean;
} | null>(null);
const isOpen = computed(() => {
  const current = choice.value;
  if (current !== null && current.status === status.value) return current.open;
  return status.value !== "done";
});
const bodyId = `cpk-subagent-${props.subagentRunId}`;

function toggle() {
  choice.value = { status: status.value, open: !isOpen.value };
}
</script>

<template>
  <div
    data-copilotkit
    :data-subagent-run-id="subagentRunId"
    :data-status="status"
    class="cpk:my-2 cpk:rounded-xl cpk:border cpk:border-zinc-200/60 cpk:px-3 cpk:py-2 cpk:dark:border-zinc-800/60"
  >
    <button
      type="button"
      :aria-expanded="isOpen"
      :aria-controls="bodyId"
      class="cpk:flex cpk:w-full cpk:cursor-pointer cpk:select-none cpk:items-center cpk:gap-2 cpk:border-none cpk:bg-transparent cpk:p-0 cpk:text-left cpk:text-sm"
      @click="toggle"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        :class="[
          'cpk:size-3.5 cpk:shrink-0 cpk:text-muted-foreground cpk:transition-transform cpk:duration-200',
          isOpen && 'cpk:rotate-90',
        ]"
      >
        <path d="m9 18 6-6-6-6" />
      </svg>
      <span class="cpk:truncate cpk:font-medium">{{
        subagent?.name ?? "Subagent"
      }}</span>
      <span
        v-if="status"
        :class="[
          'cpk:inline-flex cpk:shrink-0 cpk:items-center cpk:rounded-full cpk:px-2 cpk:py-0.5 cpk:text-[11px] cpk:font-medium',
          statusClass[status],
        ]"
        >{{ statusLabel[status] }}</span
      >
      <span
        v-if="subagent?.description"
        class="cpk:truncate cpk:text-muted-foreground"
        >{{ subagent.description }}</span
      >
    </button>
    <div :id="bodyId" :hidden="!isOpen" class="cpk:mt-2">
      <p
        v-if="subagent?.error"
        class="cpk:text-sm cpk:text-red-700 cpk:dark:text-red-400"
      >
        {{ subagent.error.message }}
      </p>
      <slot />
    </div>
  </div>
</template>
