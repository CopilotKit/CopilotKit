<script setup lang="ts">
import { computed, getCurrentInstance, onBeforeUnmount, ref } from "vue";
import type { AssistantMessage, Message } from "@ag-ui/core";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";
import { CopilotChatDefaultLabels } from "../../providers/types";
import {
  IconCheck,
  IconCopy,
  IconRefreshCw,
  IconThumbsDown,
  IconThumbsUp,
  IconVolume2,
} from "../icons";
import BasicMarkdown from "./BasicMarkdown.vue";
import { useMarkdownRenderer } from "../../providers/markdown-renderer";
import CopilotChatToolCallsView from "./CopilotChatToolCallsView.vue";
import type {
  CopilotChatAssistantMessageCopyButtonSlotProps,
  CopilotChatAssistantMessageLayoutSlotProps,
  CopilotChatAssistantMessageMessageRendererSlotProps,
  CopilotChatAssistantMessageReadAloudButtonSlotProps,
  CopilotChatAssistantMessageRegenerateButtonSlotProps,
  CopilotChatAssistantMessageThumbsDownButtonSlotProps,
  CopilotChatAssistantMessageThumbsUpButtonSlotProps,
  CopilotChatAssistantMessageToolCallsViewSlotProps,
  CopilotChatAssistantMessageToolbarSlotProps,
} from "./types";
const props = withDefaults(
  defineProps<{
    message: AssistantMessage;
    messages?: Message[];
    isRunning?: boolean;
    toolbarVisible?: boolean;
  }>(),
  {
    messages: () => [],
    isRunning: false,
    toolbarVisible: true,
  },
);

defineSlots<{
  layout?: (props: CopilotChatAssistantMessageLayoutSlotProps) => unknown;
  "message-renderer"?: (
    props: CopilotChatAssistantMessageMessageRendererSlotProps,
  ) => unknown;
  toolbar?: (props: CopilotChatAssistantMessageToolbarSlotProps) => unknown;
  "copy-button"?: (
    props: CopilotChatAssistantMessageCopyButtonSlotProps,
  ) => unknown;
  "thumbs-up-button"?: (
    props: CopilotChatAssistantMessageThumbsUpButtonSlotProps,
  ) => unknown;
  "thumbs-down-button"?: (
    props: CopilotChatAssistantMessageThumbsDownButtonSlotProps,
  ) => unknown;
  "read-aloud-button"?: (
    props: CopilotChatAssistantMessageReadAloudButtonSlotProps,
  ) => unknown;
  "regenerate-button"?: (
    props: CopilotChatAssistantMessageRegenerateButtonSlotProps,
  ) => unknown;
  "tool-calls-view"?: (
    props: CopilotChatAssistantMessageToolCallsViewSlotProps,
  ) => unknown;
  "toolbar-items"?: () => unknown;
  [key: string]: ((props: any) => unknown) | undefined;
}>();

const emit = defineEmits<{
  "thumbs-up": [message: AssistantMessage];
  "thumbs-down": [message: AssistantMessage];
  "read-aloud": [message: AssistantMessage];
  regenerate: [message: AssistantMessage];
}>();

const config = useCopilotChatConfiguration();
const labels = computed(() => config.value?.labels ?? CopilotChatDefaultLabels);
const instance = getCurrentInstance();
const copied = ref(false);
let copiedResetTimeout: ReturnType<typeof setTimeout> | null = null;
const vnodeProps = computed(
  () => (instance?.vnode.props ?? {}) as Record<string, unknown>,
);

const toolbarButtonClass = [
  "cpk:inline-flex cpk:h-8 cpk:w-8 cpk:items-center cpk:justify-center cpk:rounded-md cpk:p-0",
  "cpk:cursor-pointer cpk:text-[rgb(93,93,93)] cpk:transition-colors cpk:hover:bg-[#E8E8E8]",
  "cpk:hover:text-[rgb(93,93,93)] cpk:dark:text-[rgb(243,243,243)] cpk:dark:hover:bg-[#303030]",
  "cpk:dark:hover:text-[rgb(243,243,243)] cpk:disabled:pointer-events-none cpk:disabled:opacity-50",
].join(" ");

function normalizeContent(content: unknown): string {
  if (!content) {
    return "";
  }

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const parts = content as Array<{ type?: unknown; text?: unknown }>;
    return parts
      .map((part) => {
        if (
          part &&
          typeof part === "object" &&
          "type" in part &&
          part.type === "text" &&
          typeof part.text === "string"
        ) {
          return part.text;
        }
        return "";
      })
      .filter((text) => text.length > 0)
      .join("\n");
  }

  return "";
}

const normalizedContent = computed(() =>
  normalizeContent(props.message.content),
);
const hasContent = computed(() => normalizedContent.value.trim().length > 0);

const providerMarkdownRenderer = useMarkdownRenderer();
const ActiveMarkdownRenderer = computed(
  () => providerMarkdownRenderer ?? BasicMarkdown,
);

function hasListener(listenerName: string) {
  const listener = vnodeProps.value[listenerName];
  if (Array.isArray(listener)) {
    return listener.length > 0;
  }
  return !!listener;
}

const hasThumbsUp = computed(() => hasListener("onThumbsUp"));
const hasThumbsDown = computed(() => hasListener("onThumbsDown"));
const hasReadAloud = computed(() => hasListener("onReadAloud"));
const hasRegenerate = computed(() => hasListener("onRegenerate"));
const isLatestAssistantMessage = computed(
  () => props.messages[props.messages.length - 1]?.id === props.message.id,
);
const shouldShowToolbar = computed(
  () =>
    props.toolbarVisible &&
    hasContent.value &&
    !(props.isRunning && isLatestAssistantMessage.value),
);

function resetCopiedStateWithDelay() {
  if (copiedResetTimeout) {
    clearTimeout(copiedResetTimeout);
  }
  copied.value = true;
  copiedResetTimeout = setTimeout(() => {
    copied.value = false;
    copiedResetTimeout = null;
  }, 2000);
}

async function handleCopyMessage() {
  const content = normalizedContent.value;
  if (!content) return;

  if (
    typeof navigator === "undefined" ||
    typeof navigator.clipboard?.writeText !== "function"
  ) {
    return;
  }

  try {
    await navigator.clipboard.writeText(content);
    resetCopiedStateWithDelay();
  } catch (error) {
    console.error("Failed to copy to clipboard:", error);
  }
}

function handleThumbsUp() {
  emit("thumbs-up", props.message);
}

function handleThumbsDown() {
  emit("thumbs-down", props.message);
}

function handleReadAloud() {
  emit("read-aloud", props.message);
}

function handleRegenerate() {
  emit("regenerate", props.message);
}

onBeforeUnmount(() => {
  if (copiedResetTimeout) {
    clearTimeout(copiedResetTimeout);
  }
});
</script>

<template>
  <slot
    name="layout"
    :message="message"
    :content="normalizedContent"
    :is-running="isRunning"
    :toolbar-visible="toolbarVisible"
    :should-show-toolbar="shouldShowToolbar"
    :message-renderer="$slots['message-renderer'] ?? (() => null)"
    :toolbar="$slots['toolbar'] ?? (() => null)"
    :copy-button="$slots['copy-button'] ?? (() => null)"
    :thumbs-up-button="$slots['thumbs-up-button'] ?? (() => null)"
    :thumbs-down-button="$slots['thumbs-down-button'] ?? (() => null)"
    :read-aloud-button="$slots['read-aloud-button'] ?? (() => null)"
    :regenerate-button="$slots['regenerate-button'] ?? (() => null)"
    :tool-calls-view="$slots['tool-calls-view'] ?? (() => null)"
    :on-copy="handleCopyMessage"
    :on-thumbs-up="handleThumbsUp"
    :on-thumbs-down="handleThumbsDown"
    :on-read-aloud="handleReadAloud"
    :on-regenerate="handleRegenerate"
  >
    <div
      data-copilotkit
      data-testid="copilot-assistant-message"
      class="cpk:prose cpk:max-w-full cpk:break-words cpk:dark:prose-invert"
      :data-message-id="message.id"
      v-bind="$attrs"
    >
      <slot
        name="message-renderer"
        :message="message"
        :content="normalizedContent"
      >
        <component
          :is="ActiveMarkdownRenderer"
          v-if="hasContent"
          :content="normalizedContent"
          :is-streaming="isRunning && isLatestAssistantMessage"
        />
      </slot>

      <slot name="tool-calls-view" :message="message" :messages="messages">
        <CopilotChatToolCallsView :message="message" :messages="messages">
          <template
            v-for="(_, slotName) in $slots"
            :key="slotName"
            #[slotName]="slotProps"
          >
            <slot :name="slotName" v-bind="slotProps" />
          </template>
        </CopilotChatToolCallsView>
      </slot>

      <slot
        v-if="shouldShowToolbar"
        name="toolbar"
        :message="message"
        :should-show-toolbar="shouldShowToolbar"
      >
        <div
          class="cpk:w-full cpk:bg-transparent cpk:flex cpk:items-center cpk:-ml-[5px] cpk:-mt-[0px]"
        >
          <div class="cpk:flex cpk:items-center cpk:gap-1">
            <slot
              name="copy-button"
              :on-copy="handleCopyMessage"
              :copied="copied"
              :label="labels.assistantMessageToolbarCopyMessageLabel"
            >
              <button
                data-testid="copilot-copy-button"
                type="button"
                :class="toolbarButtonClass"
                :aria-label="labels.assistantMessageToolbarCopyMessageLabel"
                :title="labels.assistantMessageToolbarCopyMessageLabel"
                @click="handleCopyMessage"
              >
                <IconCheck v-if="copied" class="cpk:size-[18px]" />
                <IconCopy v-else class="cpk:size-[18px]" />
              </button>
            </slot>

            <slot
              v-if="hasThumbsUp"
              name="thumbs-up-button"
              :on-thumbs-up="handleThumbsUp"
              :label="labels.assistantMessageToolbarThumbsUpLabel"
            >
              <button
                type="button"
                :class="toolbarButtonClass"
                :aria-label="labels.assistantMessageToolbarThumbsUpLabel"
                :title="labels.assistantMessageToolbarThumbsUpLabel"
                @click="handleThumbsUp"
              >
                <IconThumbsUp class="cpk:size-[18px]" />
              </button>
            </slot>

            <slot
              v-if="hasThumbsDown"
              name="thumbs-down-button"
              :on-thumbs-down="handleThumbsDown"
              :label="labels.assistantMessageToolbarThumbsDownLabel"
            >
              <button
                type="button"
                :class="toolbarButtonClass"
                :aria-label="labels.assistantMessageToolbarThumbsDownLabel"
                :title="labels.assistantMessageToolbarThumbsDownLabel"
                @click="handleThumbsDown"
              >
                <IconThumbsDown class="cpk:size-[18px]" />
              </button>
            </slot>

            <slot
              v-if="hasReadAloud"
              name="read-aloud-button"
              :on-read-aloud="handleReadAloud"
              :label="labels.assistantMessageToolbarReadAloudLabel"
            >
              <button
                type="button"
                :class="toolbarButtonClass"
                :aria-label="labels.assistantMessageToolbarReadAloudLabel"
                :title="labels.assistantMessageToolbarReadAloudLabel"
                @click="handleReadAloud"
              >
                <IconVolume2 class="cpk:size-[20px]" />
              </button>
            </slot>

            <slot
              v-if="hasRegenerate"
              name="regenerate-button"
              :on-regenerate="handleRegenerate"
              :label="labels.assistantMessageToolbarRegenerateLabel"
            >
              <button
                type="button"
                :class="toolbarButtonClass"
                :aria-label="labels.assistantMessageToolbarRegenerateLabel"
                :title="labels.assistantMessageToolbarRegenerateLabel"
                @click="handleRegenerate"
              >
                <IconRefreshCw class="cpk:size-[18px]" />
              </button>
            </slot>

            <slot name="toolbar-items" />
          </div>
        </div>
      </slot>
    </div>
  </slot>
</template>
