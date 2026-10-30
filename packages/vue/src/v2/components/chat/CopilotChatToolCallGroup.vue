<script setup lang="ts">
/**
 * Tool calls made in a row, collapsed into one summary. While a call runs the
 * summary names it ("Running read_file  src/app.ts"); once they're all done it
 * reads "Used 3 tools" and opens to the calls.
 *
 * Each call is drawn by the `call` slot, which the tool calls view fills with
 * the registered renderers. CopilotKit's built-in card (`useDefaultRenderTool`)
 * draws a compact row inside the card and line appearances and an open stack;
 * a custom wildcard renderer draws whatever it draws.
 */
import { computed, provide, ref } from "vue";
import { useCopilotId } from "../ui/use-id";
import type { ToolCallEntry } from "./tool-call-layout";
import { ToolCallGroupContextKey } from "./tool-call-display-context";
import type { ToolCallGroupContextValue } from "./tool-call-display-context";
import {
  CopilotChatCollapsible,
  ToolCallChevron,
  ToolCallFailedCount,
  ToolCallStatusIcon,
  entryPreview,
  entryStatus,
  pluralize,
  statusLabels,
  toolNames,
} from "./tool-call-group-parts";
import type { ToolCallStatusName } from "./tool-call-group-parts";
import type { CopilotChatToolCallGroupAppearance } from "./types";

const props = withDefaults(
  defineProps<{
    /** The calls in the group, in order. */
    calls: ToolCallEntry[];
    /**
     * - `"card"` (default): one card with a summary header and a row per call.
     * - `"line"`: a quiet line of text that opens to a list of rows.
     * - `"stack"`: the latest call on a stack of the earlier ones.
     */
    appearance?: CopilotChatToolCallGroupAppearance;
    /** The agent is running and nothing follows the group, so more calls may join it. */
    isActive?: boolean;
  }>(),
  { appearance: "card", isActive: false },
);

defineSlots<{
  /** Draws one call. */
  call(props: { call: ToolCallEntry }): unknown;
}>();

const open = ref(false);
const bodyId = useCopilotId("cpk-tool-call-group");
const toggle = () => {
  open.value = !open.value;
};

const latest = computed(() => props.calls[props.calls.length - 1]);
// Only an active group has a call in progress. Between calls nothing is
// running, so the latest call stays the subject (or the label flickers).
const current = computed(() =>
  props.isActive
    ? (props.calls.find((call) => !call.toolMessage) ?? latest.value)
    : undefined,
);
const preview = computed(() =>
  current.value ? entryPreview(current.value) : undefined,
);
const done = computed(
  () => props.calls.filter((call) => call.toolMessage).length,
);
const statuses = computed(() =>
  props.calls.map((call) => entryStatus(call, props.isActive)),
);
const failedIds = computed(
  () =>
    new Set(
      props.calls
        .filter((_, index) => statuses.value[index] === "failed")
        .map((call) => call.toolCall.id),
    ),
);
const status = computed<ToolCallStatusName>(() =>
  current.value
    ? "running"
    : failedIds.value.size > 0
      ? "failed"
      : statuses.value.includes("stopped")
        ? "stopped"
        : "done",
);
const single = computed(
  () =>
    props.appearance === "line" && props.calls.length === 1 && !current.value,
);

provide(
  ToolCallGroupContextKey,
  computed<ToolCallGroupContextValue>(() => ({
    appearance: props.appearance,
    failedIds: failedIds.value,
    active: props.isActive,
  })),
);

// Stack: a lone call is the top card of a stack with nothing behind it yet.
const behind = computed(() =>
  open.value ? 0 : Math.min(props.calls.length - 1, 2),
);
const latestStatus = computed(() =>
  latest.value ? entryStatus(latest.value, props.isActive) : "done",
);
const latestPreview = computed(() =>
  latest.value ? entryPreview(latest.value) : undefined,
);
const layer = "cpk-tool-call-group-stack-layer";
</script>

<template>
  <div
    v-if="latest && single"
    data-copilotkit
    data-testid="copilot-tool-call-group"
    :data-appearance="appearance"
    :data-state="status"
    class="cpk-tool-call-group cpk-tool-call-group-line cpk-tool-call-group-single"
  >
    <slot name="call" :call="latest" />
  </div>

  <div
    v-else-if="latest && appearance === 'line'"
    data-copilotkit
    data-testid="copilot-tool-call-group"
    :data-appearance="appearance"
    :data-state="status"
    class="cpk-tool-call-group cpk-tool-call-group-line"
  >
    <button
      type="button"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-controls="bodyId"
      class="cpk-tool-call-group-line-toggle"
      @click="toggle"
    >
      <template v-if="current">
        <span class="cpk-tool-call-group-running cpk-shimmer"
          >Running {{ current.toolCall.function.name }}</span
        >
        <span v-if="preview" class="cpk-tool-call-group-preview">{{
          preview
        }}</span>
      </template>
      <template v-else>
        <span class="cpk-tool-call-group-line-summary"
          >Used {{ pluralize(calls.length, "tool") }}</span
        >
        <span class="cpk-tool-call-group-line-names">{{
          toolNames(calls)
        }}</span>
        <ToolCallFailedCount :calls="calls" />
      </template>
      <ToolCallChevron :open="open" />
    </button>
    <CopilotChatCollapsible :id="bodyId" :open="open">
      <div class="cpk-tool-call-group-line-body">
        <template v-for="call in calls" :key="call.toolCall.id">
          <slot name="call" :call="call" />
        </template>
      </div>
    </CopilotChatCollapsible>
  </div>

  <div
    v-else-if="latest && appearance === 'stack'"
    data-copilotkit
    data-testid="copilot-tool-call-group"
    :data-appearance="appearance"
    :data-state="status"
    class="cpk-tool-call-group cpk-tool-call-group-stack"
    :style="{ paddingBottom: `${behind * 6}px` }"
  >
    <div class="cpk-tool-call-group-stack-pile">
      <div
        v-for="index in behind"
        :key="index"
        aria-hidden="true"
        :class="[layer, 'cpk-tool-call-group-stack-behind']"
        :style="{
          transform: `translateY(${index * 6}px) scaleX(${1 - index * 0.045})`,
          zIndex: -index,
          opacity: 1 - index * 0.28,
        }"
      />
      <!-- One toggle in both states, so it keeps keyboard focus when pressed. -->
      <button
        type="button"
        :aria-expanded="open ? 'true' : 'false'"
        :aria-controls="open ? bodyId : undefined"
        :class="[
          'cpk-tool-call-group-stack-toggle',
          open
            ? 'cpk-tool-call-group-stack-toggle-open'
            : [layer, 'cpk-tool-call-group-stack-toggle-closed'],
        ]"
        @click="toggle"
      >
        <template v-if="open">
          {{ pluralize(calls.length, "tool call") }}
          <ToolCallFailedCount :calls="calls" />
          <span class="cpk-tool-call-group-stack-collapse">
            Collapse
            <ToolCallChevron
              :open="true"
              class="cpk-tool-call-group-stack-collapse-icon"
            />
          </span>
        </template>
        <template v-else>
          <span
            :key="latest.toolCall.id"
            class="cpk-tool-call-group-stack-latest"
          >
            <ToolCallStatusIcon :status="latestStatus" />
            <span
              :class="[
                'cpk-tool-call-group-stack-name',
                latestStatus === 'running' && 'cpk-shimmer',
              ]"
              >{{ latest.toolCall.function.name }}</span
            >
            <span
              v-if="latestPreview"
              class="cpk-tool-call-group-stack-preview"
              >{{ latestPreview }}</span
            >
            <!-- The status icon is decorative, so say the status. -->
            <span class="cpk-tool-call-group-stack-status">{{
              statusLabels[latestStatus]
            }}</span>
          </span>
          <span class="cpk-tool-call-group-stack-meta">
            <ToolCallFailedCount :calls="calls" />
            <span class="cpk-tool-call-group-stack-count">{{
              pluralize(calls.length, "call")
            }}</span>
            <ToolCallChevron
              :open="false"
              class="cpk-tool-call-group-stack-expand-icon"
            />
          </span>
        </template>
      </button>
      <!-- Always mounted, so screen readers hear the closed stack's latest
             call change ("read_file: Running", then "read_file: Done"); the
             button only names it. -->
      <span aria-live="polite" class="cpk-tool-call-group-stack-live">{{
        open
          ? ""
          : `${latest.toolCall.function.name}: ${statusLabels[latestStatus]}`
      }}</span>
    </div>
    <!-- Each call gets the collapsed stack's card, easing out of the stack. -->
    <div v-if="open" :id="bodyId" class="cpk-tool-call-group-stack-items">
      <div
        v-for="(call, index) in calls"
        :key="call.toolCall.id"
        :class="[layer, 'cpk-tool-call-group-stack-item']"
        :style="{ animationDelay: `${index * 30}ms` }"
      >
        <slot name="call" :call="call" />
      </div>
    </div>
  </div>

  <!-- card: one call gets the same card as several, so the card a run
         starts with doesn't change style when the next call joins it. -->
  <div
    v-else-if="latest"
    data-copilotkit
    data-testid="copilot-tool-call-group"
    :data-appearance="appearance"
    :data-state="status"
    class="cpk-tool-call-group cpk-tool-call-group-card"
  >
    <button
      type="button"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-controls="bodyId"
      class="cpk-tool-call-group-card-toggle"
      @click="toggle"
    >
      <ToolCallStatusIcon :status="status" />
      <template v-if="current">
        <span class="cpk-tool-call-group-running cpk-shimmer"
          >Running {{ current.toolCall.function.name }}</span
        >
        <span v-if="preview" class="cpk-tool-call-group-preview">{{
          preview
        }}</span>
      </template>
      <template v-else>
        <span class="cpk-tool-call-group-card-summary"
          >Used {{ pluralize(calls.length, "tool") }}</span
        >
        <span class="cpk-tool-call-group-card-names">{{
          toolNames(calls)
        }}</span>
      </template>
      <span class="cpk-tool-call-group-card-meta">
        <ToolCallFailedCount v-if="status === 'failed'" :calls="calls" />
        <span v-else class="cpk-tool-call-group-card-status">{{
          status !== "running"
            ? statusLabels[status]
            : done > 0
              ? `${done} done`
              : ""
        }}</span>
        <ToolCallChevron :open="open" />
      </span>
    </button>
    <CopilotChatCollapsible :id="bodyId" :open="open">
      <div>
        <template v-for="call in calls" :key="call.toolCall.id">
          <slot name="call" :call="call" />
        </template>
      </div>
    </CopilotChatCollapsible>
  </div>
</template>
