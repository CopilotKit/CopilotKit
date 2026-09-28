<script setup lang="ts">
import { computed, defineComponent, h, onBeforeUnmount, ref } from "vue";
import type { UserMessage } from "@ag-ui/core";
import { StreamMarkdown } from "streamdown-vue";
import { prepareUserMarkdown } from "./user-markdown";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";
import { CopilotChatDefaultLabels } from "../../providers/types";
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconEdit,
} from "../icons";
import type {
  CopilotChatUserMessageBranchNavigationSlotProps,
  CopilotChatUserMessageCopyButtonSlotProps,
  CopilotChatUserMessageEditButtonSlotProps,
  CopilotChatUserMessageLayoutSlotProps,
  CopilotChatUserMessageMessageRendererSlotProps,
  CopilotChatUserMessageOnEditMessageProps,
  CopilotChatUserMessageOnSwitchToBranchProps,
  CopilotChatUserMessageToolbarSlotProps,
} from "./types";

// Headings that slip past prepareUserMarkdown (e.g. setext underlines) render
// as plain paragraphs: a user message never grows article-sized headings.
const PlainParagraph = defineComponent({
  name: "CopilotUserMarkdownParagraph",
  inheritAttrs: false,
  setup(_, { slots }) {
    return () => h("p", slots.default?.());
  },
});
const userMarkdownComponents = {
  h1: PlainParagraph,
  h2: PlainParagraph,
  h3: PlainParagraph,
  h4: PlainParagraph,
  h5: PlainParagraph,
  h6: PlainParagraph,
};

const props = withDefaults(
  defineProps<{
    message: UserMessage;
    branchIndex?: number;
    numberOfBranches?: number;
    onEditMessage?: (payload: CopilotChatUserMessageOnEditMessageProps) => void;
    onSwitchToBranch?: (
      payload: CopilotChatUserMessageOnSwitchToBranchProps,
    ) => void;
    /**
     * Render the message as markdown (code, lists, emphasis, links, tables).
     * Defaults to `true`; set `false` to show the text as typed.
     */
    markdown?: boolean;
  }>(),
  {
    branchIndex: 0,
    numberOfBranches: 1,
    markdown: true,
  },
);

defineSlots<{
  "message-renderer"?: (
    props: CopilotChatUserMessageMessageRendererSlotProps,
  ) => unknown;
  toolbar?: (props: CopilotChatUserMessageToolbarSlotProps) => unknown;
  "copy-button"?: (props: CopilotChatUserMessageCopyButtonSlotProps) => unknown;
  "edit-button"?: (props: CopilotChatUserMessageEditButtonSlotProps) => unknown;
  "branch-navigation"?: (
    props: CopilotChatUserMessageBranchNavigationSlotProps,
  ) => unknown;
  layout?: (props: CopilotChatUserMessageLayoutSlotProps) => unknown;
  "toolbar-items"?: () => unknown;
}>();

const emit = defineEmits<{
  "edit-message": [payload: CopilotChatUserMessageOnEditMessageProps];
  "switch-to-branch": [payload: CopilotChatUserMessageOnSwitchToBranchProps];
}>();

const config = useCopilotChatConfiguration();
const labels = computed(() => config.value?.labels ?? CopilotChatDefaultLabels);
const copied = ref(false);
let copiedResetTimeout: ReturnType<typeof setTimeout> | null = null;

const buttonBaseClass = [
  "cpk:inline-flex cpk:items-center cpk:justify-center cpk:rounded-md cpk:p-0",
  "cpk:cursor-pointer cpk:text-muted-foreground cpk:transition-colors cpk:hover:bg-accent cpk:hover:text-foreground",
  "cpk:disabled:pointer-events-none cpk:disabled:opacity-50",
].join(" ");
// 28×36, matching React's toolbar buttons.
const toolbarButtonClass = `${buttonBaseClass} cpk:h-9 cpk:w-7`;
const branchButtonClass = `${buttonBaseClass} cpk:size-6`;

function flattenUserMessageContent(content?: UserMessage["content"]): string {
  if (!content) {
    return "";
  }

  if (typeof content === "string") {
    return content;
  }

  return content
    .map((part) => {
      if (
        part &&
        typeof part === "object" &&
        "type" in part &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }
      return "";
    })
    .filter((text) => text.length > 0)
    .join("\n");
}

const flattenedContent = computed(() =>
  flattenUserMessageContent(props.message.content),
);
const isMultiline = computed(() => flattenedContent.value.includes("\n"));
const userMarkdown = computed(() =>
  prepareUserMarkdown(flattenedContent.value),
);
const hasEditAction = computed(() => typeof props.onEditMessage === "function");
const showBranchNavigation = computed(
  () =>
    props.numberOfBranches > 1 && typeof props.onSwitchToBranch === "function",
);

const canGoPrev = computed(
  () => showBranchNavigation.value && props.branchIndex > 0,
);
const canGoNext = computed(
  () =>
    showBranchNavigation.value &&
    props.branchIndex < props.numberOfBranches - 1,
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
  if (!flattenedContent.value) return;

  if (
    typeof navigator === "undefined" ||
    typeof navigator.clipboard?.writeText !== "function"
  ) {
    return;
  }

  try {
    await navigator.clipboard.writeText(flattenedContent.value);
    resetCopiedStateWithDelay();
  } catch (error) {
    console.error("Failed to copy to clipboard:", error);
  }
}

function handleEditMessage() {
  if (!hasEditAction.value) {
    return;
  }
  const payload = { message: props.message };
  emit("edit-message", payload);
}

function switchToBranch(branchIndex: number) {
  if (!showBranchNavigation.value) {
    return;
  }
  const payload = {
    branchIndex,
    numberOfBranches: props.numberOfBranches,
    message: props.message,
  };
  emit("switch-to-branch", payload);
}

function goPrev() {
  if (!canGoPrev.value) {
    return;
  }
  switchToBranch(props.branchIndex - 1);
}

function goNext() {
  if (!canGoNext.value) {
    return;
  }
  switchToBranch(props.branchIndex + 1);
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
    :content="flattenedContent"
    :is-multiline="isMultiline"
    :show-branch-navigation="showBranchNavigation"
    :has-edit-action="hasEditAction"
    :branch-index="branchIndex"
    :number-of-branches="numberOfBranches"
    :can-go-prev="canGoPrev"
    :can-go-next="canGoNext"
    :on-copy="handleCopyMessage"
    :on-edit="handleEditMessage"
    :go-prev="goPrev"
    :go-next="goNext"
    :copied="copied"
  >
    <div
      data-copilotkit
      data-testid="copilot-user-message"
      class="cpk:flex cpk:flex-col cpk:items-end cpk:group cpk:pt-8"
      :data-message-id="message.id"
      v-bind="$attrs"
    >
      <slot
        name="message-renderer"
        :message="message"
        :content="flattenedContent"
        :is-multiline="isMultiline"
      >
        <div
          class="cpk:prose cpk:dark:prose-invert cpk:bg-muted cpk:text-foreground cpk:relative cpk:max-w-[80%] cpk:min-w-0 cpk:rounded-2xl cpk:px-4 cpk:py-2 cpk:inline-block cpk:break-words"
          :class="{ 'cpk:whitespace-pre-wrap': !markdown }"
          :data-multiline="isMultiline ? 'true' : undefined"
        >
          <template v-if="!markdown">{{ flattenedContent }}</template>
          <StreamMarkdown
            v-else
            class="copilot-chat-user-markdown"
            :content="userMarkdown"
            :components="userMarkdownComponents"
            :parse-incomplete-markdown="false"
            :code-block-hide-copy="true"
            :code-block-hide-download="true"
            :code-block-show-line-numbers="false"
            :shiki-theme="{ light: 'github-light', dark: 'github-dark' }"
          />
        </div>
      </slot>

      <slot
        name="toolbar"
        :message="message"
        :show-branch-navigation="showBranchNavigation"
        :has-edit-action="hasEditAction"
      >
        <div
          data-testid="copilot-user-toolbar"
          class="cpk:w-full cpk:bg-transparent cpk:flex cpk:items-center cpk:justify-end cpk:-mr-1 cpk:mt-1 cpk:invisible cpk:group-hover:visible"
        >
          <div class="cpk:flex cpk:items-center cpk:gap-0.5 cpk:justify-end">
            <slot name="toolbar-items" />

            <slot
              name="copy-button"
              :on-copy="handleCopyMessage"
              :copied="copied"
              :label="labels.userMessageToolbarCopyMessageLabel"
            >
              <button
                data-testid="copilot-user-copy-button"
                type="button"
                :class="toolbarButtonClass"
                :aria-label="labels.userMessageToolbarCopyMessageLabel"
                :title="labels.userMessageToolbarCopyMessageLabel"
                @click="handleCopyMessage"
              >
                <IconCheck v-if="copied" class="cpk:size-4" />
                <IconCopy v-else class="cpk:size-4" />
              </button>
            </slot>

            <slot
              v-if="hasEditAction || $slots['edit-button']"
              name="edit-button"
              :on-edit="handleEditMessage"
              :label="labels.userMessageToolbarEditMessageLabel"
            >
              <button
                type="button"
                :class="toolbarButtonClass"
                :aria-label="labels.userMessageToolbarEditMessageLabel"
                :title="labels.userMessageToolbarEditMessageLabel"
                @click="handleEditMessage"
              >
                <IconEdit class="cpk:size-4" />
              </button>
            </slot>

            <slot
              v-if="
                numberOfBranches > 1 &&
                (showBranchNavigation || $slots['branch-navigation'])
              "
              name="branch-navigation"
              :branch-index="branchIndex"
              :number-of-branches="numberOfBranches"
              :can-go-prev="canGoPrev"
              :can-go-next="canGoNext"
              :go-prev="goPrev"
              :go-next="goNext"
            >
              <div class="cpk:flex cpk:items-center cpk:gap-0.5">
                <button
                  type="button"
                  :class="branchButtonClass"
                  :disabled="!canGoPrev"
                  aria-label="Previous branch"
                  title="Previous branch"
                  @click="goPrev"
                >
                  <IconChevronLeft class="cpk:size-4" />
                </button>
                <span
                  class="cpk:min-w-7 cpk:text-center cpk:text-xs cpk:tabular-nums cpk:text-muted-foreground cpk:font-medium"
                >
                  {{ branchIndex + 1 }}/{{ numberOfBranches }}
                </span>
                <button
                  type="button"
                  :class="branchButtonClass"
                  :disabled="!canGoNext"
                  aria-label="Next branch"
                  title="Next branch"
                  @click="goNext"
                >
                  <IconChevronRight class="cpk:size-4" />
                </button>
              </div>
            </slot>
          </div>
        </div>
      </slot>
    </div>
  </slot>
</template>
