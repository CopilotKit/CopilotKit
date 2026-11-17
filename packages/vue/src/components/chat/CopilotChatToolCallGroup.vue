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
import {
  ɵformatLabel,
  ɵformatToolNames,
  ɵgetToolCallGroupState,
  ɵformatCountLabel,
} from "@copilotkit/core";
import type { ToolCallEntry } from "@copilotkit/core";
import { useCopilotId } from "../ui/use-id";
import { ToolCallGroupContextKey } from "./tool-call-display-context";
import type { ToolCallGroupContextValue } from "./tool-call-display-context";
import {
  CopilotChatCollapsible,
  ToolCallChevron,
  ToolCallFailedCount,
  ToolCallStatusIcon,
  toolCallStatusLabel,
} from "./tool-call-group-parts";
import { useChatLabels } from "./use-chat-labels";
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

const labels = useChatLabels();
const open = ref(false);
const bodyId = useCopilotId("cpk-tool-call-group");
const toggle = () => {
  open.value = !open.value;
};

const state = computed(() =>
  ɵgetToolCallGroupState(props.calls, props.isActive, open.value),
);
const latest = computed(() => state.value.latest);
const current = computed(() => state.value.current);
const preview = computed(() => state.value.preview);
const done = computed(() => state.value.done);
const failedIds = computed(() => state.value.failedIds);
const status = computed(() => state.value.status);
const single = computed(
  () =>
    props.appearance === "line" && props.calls.length === 1 && !current.value,
);

provide(
  ToolCallGroupContextKey,
  computed<ToolCallGroupContextValue>(() => ({
    appearance: props.appearance,
    failedIds: failedIds.value,
    statusById: state.value.statusById,
    active: props.isActive,
  })),
);

// Stack: a lone call is the top card of a stack with nothing behind it yet.
const behind = computed(() => state.value.behind);
const latestStatus = computed(() => state.value.latestStatus);
const latestPreview = computed(() => state.value.latestPreview);
const runningLabel = computed(() =>
  current.value
    ? ɵformatLabel(labels.value.toolCallRunningLabel, {
        name: current.value.toolCall.function.name,
      })
    : "",
);
const usedToolsLabel = computed(() =>
  ɵformatCountLabel(props.calls.length, {
    one: labels.value.toolCallUsedToolsOne,
    other: labels.value.toolCallUsedToolsOther,
  }),
);
const toolNames = computed(() => ɵformatToolNames(props.calls));
const latestStatusLabel = computed(() =>
  toolCallStatusLabel(labels.value, latestStatus.value),
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
        <span class="cpk-tool-call-group-running cpk-shimmer">{{
          runningLabel
        }}</span>
        <span v-if="preview" class="cpk-tool-call-group-preview">{{
          preview
        }}</span>
      </template>
      <template v-else>
        <span class="cpk-tool-call-group-line-summary">{{
          usedToolsLabel
        }}</span>
        <span class="cpk-tool-call-group-line-names">{{ toolNames }}</span>
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
          {{
            ɵformatCountLabel(calls.length, {
              one: labels.toolCallToolCallCountOne,
              other: labels.toolCallToolCallCountOther,
            })
          }}
          <ToolCallFailedCount :calls="calls" />
          <span class="cpk-tool-call-group-stack-collapse">
            {{ labels.toolCallCollapseLabel }}
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
              latestStatusLabel
            }}</span>
          </span>
          <span class="cpk-tool-call-group-stack-meta">
            <ToolCallFailedCount :calls="calls" />
            <span class="cpk-tool-call-group-stack-count">{{
              ɵformatCountLabel(calls.length, {
                one: labels.toolCallCallCountOne,
                other: labels.toolCallCallCountOther,
              })
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
        open ? "" : `${latest.toolCall.function.name}: ${latestStatusLabel}`
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
        <span class="cpk-tool-call-group-running cpk-shimmer">{{
          runningLabel
        }}</span>
        <span v-if="preview" class="cpk-tool-call-group-preview">{{
          preview
        }}</span>
      </template>
      <template v-else>
        <span class="cpk-tool-call-group-card-summary">{{
          usedToolsLabel
        }}</span>
        <span class="cpk-tool-call-group-card-names">{{ toolNames }}</span>
      </template>
      <span class="cpk-tool-call-group-card-meta">
        <ToolCallFailedCount v-if="status === 'failed'" :calls="calls" />
        <span v-else class="cpk-tool-call-group-card-status">{{
          status !== "running"
            ? toolCallStatusLabel(labels, status)
            : done > 0
              ? ɵformatLabel(labels.toolCallDoneCountLabel, { count: done })
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
