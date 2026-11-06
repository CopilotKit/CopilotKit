<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from "vue";
import type { Message, ReasoningMessage } from "@ag-ui/core";
import { IconChevronRight } from "../icons";
import StreamingMarkdownDefault from "./StreamingMarkdownDefault.vue";
import {
  ɵgetReasoningHeaderLabel,
  ɵReasoningDisclosure,
} from "@copilotkit/core";
import { useChatLabels } from "./use-chat-labels";

const props = withDefaults(
  defineProps<{
    message: ReasoningMessage;
    messages?: Message[];
    isRunning?: boolean;
  }>(),
  {
    messages: () => [],
    isRunning: false,
  },
);

defineSlots<{
  layout?: (props: {
    message: ReasoningMessage;
    messages: Message[];
    isRunning: boolean;
    header: {
      isOpen: boolean;
      label: string;
      hasContent: boolean;
      isStreaming: boolean;
      elapsedSeconds: number;
      onClick?: () => void;
    };
    contentView: {
      isStreaming: boolean;
      hasContent: boolean;
      content: string;
    };
    toggle: {
      isOpen: boolean;
      contentView: {
        isStreaming: boolean;
        hasContent: boolean;
        content: string;
      };
    };
  }) => unknown;
  header?: (props: {
    isOpen: boolean;
    label: string;
    hasContent: boolean;
    isStreaming: boolean;
    /** Seconds spent reasoning so far, for building a localized label. */
    elapsedSeconds: number;
    onClick?: () => void;
  }) => unknown;
  "content-view"?: (props: {
    isStreaming: boolean;
    hasContent: boolean;
    content: string;
  }) => unknown;
  toggle?: (props: {
    isOpen: boolean;
    contentView: {
      isStreaming: boolean;
      hasContent: boolean;
      content: string;
    };
  }) => unknown;
}>();

const normalizedContent = computed(() =>
  typeof props.message.content === "string" ? props.message.content : "",
);
const hasContent = computed(() => normalizedContent.value.length > 0);
const isLatest = computed(
  () => props.messages[props.messages.length - 1]?.id === props.message.id,
);
const isStreaming = computed(() => !!(props.isRunning && isLatest.value));

// Open while streaming, auto-collapse when it ends unless the user toggled,
// and the elapsed time: see core's ɵReasoningDisclosure.
const disclosure = new ɵReasoningDisclosure({ isStreaming: isStreaming.value });
const disclosureState = shallowRef(disclosure.getSnapshot());
const unsubscribe = disclosure.subscribe(() => {
  disclosureState.value = disclosure.getSnapshot();
});
watch(isStreaming, (next) => disclosure.setStreaming(next), {
  immediate: true,
});
onBeforeUnmount(() => {
  unsubscribe();
  disclosure.dispose();
});

const elapsed = computed(() => disclosureState.value.elapsedSeconds);
const isOpen = computed(() => disclosureState.value.isOpen);

const labels = useChatLabels();
/** `labels.reasoningMessageThinkingLabel` while streaming, then "Thought for …". */
const label = computed(() =>
  ɵgetReasoningHeaderLabel(
    { isStreaming: isStreaming.value, elapsedSeconds: elapsed.value },
    labels.value,
  ),
);

function toggleOpen() {
  if (!hasContent.value) return;
  disclosure.toggle();
}
</script>

<template>
  <div
    data-copilotkit
    class="cpk-reasoning-message"
    :data-message-id="message.id"
  >
    <slot
      name="layout"
      :message="message"
      :messages="messages"
      :is-running="isRunning"
      :header="{
        isOpen,
        label,
        hasContent,
        isStreaming,
        elapsedSeconds: elapsed,
        onClick: hasContent ? toggleOpen : undefined,
      }"
      :content-view="{
        isStreaming,
        hasContent,
        content: normalizedContent,
      }"
      :toggle="{
        isOpen,
        contentView: {
          isStreaming,
          hasContent,
          content: normalizedContent,
        },
      }"
    >
      <slot
        name="header"
        :is-open="isOpen"
        :label="label"
        :has-content="hasContent"
        :is-streaming="isStreaming"
        :elapsed-seconds="elapsed"
        :on-click="hasContent ? toggleOpen : undefined"
      >
        <button
          type="button"
          class="cpk-reasoning-message-header"
          :class="{ 'cpk-reasoning-message-header-expandable': hasContent }"
          :aria-expanded="hasContent ? isOpen : undefined"
          @click="hasContent ? toggleOpen() : undefined"
        >
          <span class="cpk-reasoning-message-label">{{ label }}</span>
          <span
            v-if="isStreaming && !hasContent"
            class="cpk-reasoning-message-indicator"
          >
            <span class="cpk-reasoning-message-indicator-dot" />
          </span>
          <IconChevronRight
            v-if="hasContent"
            class="cpk-reasoning-message-chevron"
            :class="{ 'cpk-reasoning-message-chevron-open': isOpen }"
          />
        </button>
      </slot>

      <slot
        name="toggle"
        :is-open="isOpen"
        :content-view="{
          isStreaming,
          hasContent,
          content: normalizedContent,
        }"
      >
        <div
          class="cpk-reasoning-message-toggle"
          :style="{ gridTemplateRows: isOpen ? '1fr' : '0fr' }"
        >
          <div class="cpk-reasoning-message-toggle-content">
            <slot
              name="content-view"
              :is-streaming="isStreaming"
              :has-content="hasContent"
              :content="normalizedContent"
            >
              <div
                v-if="hasContent || isStreaming"
                class="cpk-reasoning-message-content"
              >
                <div class="cpk-reasoning-message-text">
                  <!-- Reasoning content uses the streaming renderer (same as assistant);
                       the pluggable provider renderer applies to assistant messages only. -->
                  <StreamingMarkdownDefault
                    :content="normalizedContent"
                    :is-streaming="isStreaming"
                  />
                  <span
                    v-if="isStreaming && hasContent"
                    class="cpk-reasoning-message-cursor"
                  >
                    <span class="cpk-reasoning-message-cursor-dot" />
                  </span>
                </div>
              </div>
            </slot>
          </div>
        </div>
      </slot>
    </slot>
  </div>
</template>
