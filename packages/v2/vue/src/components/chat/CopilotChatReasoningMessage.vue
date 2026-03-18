<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { Message, ReasoningMessage } from "@ag-ui/core";
import { StreamMarkdown } from "streamdown-vue";
import { IconChevronRight } from "../icons";

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

function formatDuration(seconds: number): string {
  if (seconds < 1) return "a few seconds";
  if (seconds < 60) return `${Math.round(seconds)} seconds`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (secs === 0) return `${mins} minute${mins > 1 ? "s" : ""}`;
  return `${mins}m ${secs}s`;
}

const normalizedContent = computed(() =>
  typeof props.message.content === "string" ? props.message.content : "",
);
const hasContent = computed(() => normalizedContent.value.length > 0);
const isLatest = computed(
  () => props.messages[props.messages.length - 1]?.id === props.message.id,
);
const isStreaming = computed(() => !!(props.isRunning && isLatest.value));

const elapsed = ref(0);
const isOpen = ref(isStreaming.value);
let startTimeMs: number | null = null;
let elapsedInterval: ReturnType<typeof setInterval> | null = null;

function clearElapsedInterval() {
  if (elapsedInterval) {
    clearInterval(elapsedInterval);
    elapsedInterval = null;
  }
}

function updateElapsedNow() {
  if (startTimeMs !== null) {
    elapsed.value = (Date.now() - startTimeMs) / 1000;
  }
}

watch(
  isStreaming,
  (nextIsStreaming) => {
    if (nextIsStreaming) {
      if (startTimeMs === null) {
        startTimeMs = Date.now();
      }
      clearElapsedInterval();
      elapsedInterval = setInterval(updateElapsedNow, 1000);
      isOpen.value = true;
      return;
    }

    clearElapsedInterval();
    updateElapsedNow();
    isOpen.value = false;
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  clearElapsedInterval();
});

const label = computed(() =>
  isStreaming.value
    ? "Thinking…"
    : `Thought for ${formatDuration(elapsed.value)}`,
);

function toggleOpen() {
  if (!hasContent.value) return;
  isOpen.value = !isOpen.value;
}
</script>

<template>
  <div class="my-1" :data-message-id="message.id">
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
        :on-click="hasContent ? toggleOpen : undefined"
      >
        <button
          type="button"
          class="inline-flex items-center gap-1 py-1 text-sm text-muted-foreground transition-colors select-none"
          :class="hasContent ? 'hover:text-foreground cursor-pointer' : 'cursor-default'"
          :aria-expanded="hasContent ? isOpen : undefined"
          @click="hasContent ? toggleOpen() : undefined"
        >
          <span class="font-medium">{{ label }}</span>
          <span
            v-if="isStreaming && !hasContent"
            class="inline-flex items-center ml-1"
          >
            <span class="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-pulse" />
          </span>
          <IconChevronRight
            v-if="hasContent"
            class="size-3.5 shrink-0 transition-transform duration-200"
            :class="{ 'rotate-90': isOpen }"
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
        <div v-if="isOpen">
          <slot
            name="content-view"
            :is-streaming="isStreaming"
            :has-content="hasContent"
            :content="normalizedContent"
          >
            <div
              v-if="hasContent || isStreaming"
              class="pb-2 pt-1"
            >
              <div class="text-sm text-muted-foreground">
                <StreamMarkdown :markdown="normalizedContent" />
                <span
                  v-if="isStreaming && hasContent"
                  class="inline-flex items-center ml-1 align-middle"
                >
                  <span class="w-2 h-2 rounded-full bg-muted-foreground animate-pulse-cursor" />
                </span>
              </div>
            </div>
          </slot>
        </div>
      </slot>
    </slot>
  </div>
</template>
