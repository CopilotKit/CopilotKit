<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import type { UserMessage } from "@ag-ui/core";
import type {
  AudioInputPart,
  DocumentInputPart,
  ImageInputPart,
  VideoInputPart,
} from "@copilotkit/shared";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";
import { CopilotChatDefaultLabels } from "../../providers/types";
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconEdit,
} from "../icons";
import CopilotTooltip from "../ui/CopilotTooltip.vue";
import CopilotChatAttachmentRenderer from "./CopilotChatAttachmentRenderer.vue";
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
    onEditMessage?: (payload: CopilotChatUserMessageOnEditMessageProps) => void;
    onSwitchToBranch?: (
      payload: CopilotChatUserMessageOnSwitchToBranchProps,
    ) => void;
  }>(),
  {
    branchIndex: 0,
    numberOfBranches: 1,
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

// Styles live in @copilotkit/core (ui/button.css, user-message.css).
const toolbarButtonClass =
  "cpk-button cpk-button-assistant-message-toolbar cpk-button-size-default";

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

type MediaPart =
  | ImageInputPart
  | AudioInputPart
  | VideoInputPart
  | DocumentInputPart;

function getMediaParts(content: UserMessage["content"]): MediaPart[] {
  if (!content || typeof content === "string") return [];
  return content.filter(
    (part): part is MediaPart =>
      part.type === "image" ||
      part.type === "audio" ||
      part.type === "video" ||
      part.type === "document",
  );
}

function getFilename(part: MediaPart): string | undefined {
  const meta = part.metadata;
  if (
    meta != null &&
    typeof meta === "object" &&
    "filename" in meta &&
    typeof meta.filename === "string"
  ) {
    return meta.filename;
  }
  return undefined;
}

const mediaParts = computed(() => getMediaParts(props.message.content));

const flattenedContent = computed(() =>
  flattenUserMessageContent(props.message.content),
);
const isMultiline = computed(() => flattenedContent.value.includes("\n"));
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
      class="copilotKitMessage copilotKitUserMessage cpk-user-message"
      :data-message-id="message.id"
      v-bind="$attrs"
    >
      <div
        v-if="mediaParts.length > 0"
        class="cpk-user-message-attachments"
        data-testid="copilot-user-message-attachments"
      >
        <CopilotChatAttachmentRenderer
          v-for="(part, index) in mediaParts"
          :key="index"
          :type="part.type"
          :source="part.source"
          :filename="getFilename(part)"
        />
      </div>

      <slot
        name="message-renderer"
        :message="message"
        :content="flattenedContent"
        :is-multiline="isMultiline"
      >
        <div class="cpk-user-message-bubble">
          {{ flattenedContent }}
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
          class="cpk-user-message-toolbar"
        >
          <div class="cpk-user-message-toolbar-items">
            <slot name="toolbar-items" />

            <slot
              name="copy-button"
              :on-copy="handleCopyMessage"
              :copied="copied"
              :label="labels.userMessageToolbarCopyMessageLabel"
            >
              <CopilotTooltip
                v-slot="{ triggerProps }"
                :content="labels.userMessageToolbarCopyMessageLabel"
                side="bottom"
              >
                <button
                  data-testid="copilot-user-copy-button"
                  type="button"
                  :class="toolbarButtonClass"
                  :aria-label="labels.userMessageToolbarCopyMessageLabel"
                  v-bind="triggerProps"
                  @click="handleCopyMessage"
                >
                  <IconCheck
                    v-if="copied"
                    class="cpk-user-message-toolbar-icon"
                  />
                  <IconCopy v-else class="cpk-user-message-toolbar-icon" />
                </button>
              </CopilotTooltip>
            </slot>

            <slot
              v-if="hasEditAction || $slots['edit-button']"
              name="edit-button"
              :on-edit="handleEditMessage"
              :label="labels.userMessageToolbarEditMessageLabel"
            >
              <CopilotTooltip
                v-slot="{ triggerProps }"
                :content="labels.userMessageToolbarEditMessageLabel"
                side="bottom"
              >
                <button
                  data-testid="copilot-edit-button"
                  type="button"
                  :class="toolbarButtonClass"
                  :aria-label="labels.userMessageToolbarEditMessageLabel"
                  v-bind="triggerProps"
                  @click="handleEditMessage"
                >
                  <IconEdit class="cpk-user-message-toolbar-icon" />
                </button>
              </CopilotTooltip>
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
              <div
                data-testid="copilot-branch-navigation"
                class="cpk-user-message-branch-navigation"
              >
                <button
                  type="button"
                  :class="toolbarButtonClass"
                  class="cpk-user-message-branch-button"
                  :disabled="!canGoPrev"
                  :aria-label="labels.userMessageToolbarPreviousBranchLabel"
                  @click="goPrev"
                >
                  <IconChevronLeft class="cpk-user-message-branch-icon" />
                </button>
                <span class="cpk-user-message-branch-counter">
                  {{ branchIndex + 1 }}/{{ numberOfBranches }}
                </span>
                <button
                  type="button"
                  :class="toolbarButtonClass"
                  class="cpk-user-message-branch-button"
                  :disabled="!canGoNext"
                  :aria-label="labels.userMessageToolbarNextBranchLabel"
                  @click="goNext"
                >
                  <IconChevronRight class="cpk-user-message-branch-icon" />
                </button>
              </div>
            </slot>
          </div>
        </div>
      </slot>
    </div>
  </slot>
</template>
