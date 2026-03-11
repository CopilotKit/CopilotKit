<script setup lang="ts">
import { computed, getCurrentInstance, onBeforeUnmount, ref } from "vue";
import type { UserMessage } from "@ag-ui/core";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";
import { CopilotChatDefaultLabels } from "../../providers/types";
import { IconCheck, IconChevronLeft, IconChevronRight, IconCopy, IconEdit } from "../icons";
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

const props = withDefaults(
  defineProps<{
    message: UserMessage;
    branchIndex?: number;
    numberOfBranches?: number;
  }>(),
  {
    branchIndex: 0,
    numberOfBranches: 1,
  },
);

defineSlots<{
  "message-renderer"?: (props: CopilotChatUserMessageMessageRendererSlotProps) => unknown;
  toolbar?: (props: CopilotChatUserMessageToolbarSlotProps) => unknown;
  "copy-button"?: (props: CopilotChatUserMessageCopyButtonSlotProps) => unknown;
  "edit-button"?: (props: CopilotChatUserMessageEditButtonSlotProps) => unknown;
  "branch-navigation"?: (props: CopilotChatUserMessageBranchNavigationSlotProps) => unknown;
  layout?: (props: CopilotChatUserMessageLayoutSlotProps) => unknown;
  "toolbar-items"?: () => unknown;
}>();

const emit = defineEmits<{
  "edit-message": [payload: CopilotChatUserMessageOnEditMessageProps];
  "switch-to-branch": [payload: CopilotChatUserMessageOnSwitchToBranchProps];
}>();

const config = useCopilotChatConfiguration();
const labels = computed(() => config.value?.labels ?? CopilotChatDefaultLabels);
const instance = getCurrentInstance();
const copied = ref(false);
let copiedResetTimeout: ReturnType<typeof setTimeout> | null = null;
const vnodeProps = computed(() => (instance?.vnode.props ?? {}) as Record<string, unknown>);

const toolbarButtonClass = [
  "inline-flex h-8 w-8 items-center justify-center rounded-md p-0",
  "cursor-pointer text-[rgb(93,93,93)] transition-colors hover:bg-[#E8E8E8]",
  "hover:text-[rgb(93,93,93)] dark:text-[rgb(243,243,243)] dark:hover:bg-[#303030]",
  "dark:hover:text-[rgb(243,243,243)] disabled:pointer-events-none disabled:opacity-50",
].join(" ");

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

const flattenedContent = computed(() => flattenUserMessageContent(props.message.content));
const isMultiline = computed(() => flattenedContent.value.includes("\n"));
function hasListener(listenerName: string) {
  const listener = vnodeProps.value[listenerName];
  if (Array.isArray(listener)) {
    return listener.length > 0;
  }
  return !!listener;
}

const hasEditAction = computed(() => hasListener("onEditMessage"));
const showBranchNavigation = computed(() => props.numberOfBranches > 1 && hasListener("onSwitchToBranch"));

const canGoPrev = computed(() => props.branchIndex > 0);
const canGoNext = computed(() => props.branchIndex < props.numberOfBranches - 1);

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

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(flattenedContent.value);
      resetCopiedStateWithDelay();
    } catch {
      resetCopiedStateWithDelay();
    }
  } else {
    resetCopiedStateWithDelay();
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
    <div class="flex flex-col items-end group pt-10" :data-message-id="message.id" v-bind="$attrs">
      <slot
        name="message-renderer"
        :message="message"
        :content="flattenedContent"
        :is-multiline="isMultiline"
      >
        <div
          class="prose dark:prose-invert bg-muted relative max-w-[80%] rounded-[18px] px-4 py-1.5 inline-block whitespace-pre-wrap"
          :data-multiline="isMultiline ? 'true' : undefined"
          :class="{ 'py-3': isMultiline }"
        >
          {{ flattenedContent }}
        </div>
      </slot>

      <slot
        name="toolbar"
        :message="message"
        :show-branch-navigation="showBranchNavigation"
        :has-edit-action="hasEditAction"
      >
        <div class="w-full bg-transparent flex items-center justify-end -mr-[5px] mt-[4px] invisible group-hover:visible">
          <div class="flex items-center gap-1 justify-end">
            <slot name="toolbar-items" />

            <slot
              name="copy-button"
              :on-copy="handleCopyMessage"
              :copied="copied"
              :label="labels.userMessageToolbarCopyMessageLabel"
            >
              <button
                type="button"
                :class="toolbarButtonClass"
                :aria-label="labels.userMessageToolbarCopyMessageLabel"
                :title="labels.userMessageToolbarCopyMessageLabel"
                @click="handleCopyMessage"
              >
                <IconCheck v-if="copied" class="size-[18px]" />
                <IconCopy v-else class="size-[18px]" />
              </button>
            </slot>

            <slot
              v-if="hasEditAction"
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
                <IconEdit class="size-[18px]" />
              </button>
            </slot>

            <slot
              v-if="showBranchNavigation"
              name="branch-navigation"
              :branch-index="branchIndex"
              :number-of-branches="numberOfBranches"
              :can-go-prev="canGoPrev"
              :can-go-next="canGoNext"
              :go-prev="goPrev"
              :go-next="goNext"
            >
              <div class="flex items-center gap-1">
                <button
                  type="button"
                  :class="toolbarButtonClass"
                  class="h-6 w-6 p-0"
                  :disabled="!canGoPrev"
                  aria-label="Previous branch"
                  title="Previous branch"
                  @click="goPrev"
                >
                  <IconChevronLeft class="size-[20px]" />
                </button>
                <span class="text-sm text-muted-foreground px-0 font-medium">
                  {{ branchIndex + 1 }}/{{ numberOfBranches }}
                </span>
                <button
                  type="button"
                  :class="toolbarButtonClass"
                  class="h-6 w-6 p-0"
                  :disabled="!canGoNext"
                  aria-label="Next branch"
                  title="Next branch"
                  @click="goNext"
                >
                  <IconChevronRight class="size-[20px]" />
                </button>
              </div>
            </slot>
          </div>
        </div>
      </slot>
    </div>
  </slot>
</template>
