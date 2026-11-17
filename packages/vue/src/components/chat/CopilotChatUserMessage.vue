<script setup lang="ts">
import { computed } from "vue";
import type { UserMessage } from "@ag-ui/core";
import {
  ɵflattenUserMessageContent,
  ɵgetBranchNavState,
  ɵgetUserMessageMediaFilename,
  ɵgetUserMessageMediaParts,
} from "@copilotkit/core";
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
import { useCopyFeedback } from "./use-copy-feedback";
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
const { copied, copy } = useCopyFeedback();

// Styles live in @copilotkit/core (ui/button.css, user-message.css).
const toolbarButtonClass =
  "cpk-button cpk-button-assistant-message-toolbar cpk-button-size-default";

const mediaParts = computed(() =>
  ɵgetUserMessageMediaParts(props.message.content),
);

const flattenedContent = computed(() =>
  ɵflattenUserMessageContent(props.message.content),
);
const isMultiline = computed(() => flattenedContent.value.includes("\n"));
const hasEditAction = computed(() => typeof props.onEditMessage === "function");
const branchNav = computed(() =>
  ɵgetBranchNavState({
    branchIndex: props.branchIndex,
    numberOfBranches: props.numberOfBranches,
    canSwitch: typeof props.onSwitchToBranch === "function",
  }),
);
const showBranchNavigation = computed(() => branchNav.value.show);
const canGoPrev = computed(() => branchNav.value.canGoPrev);
const canGoNext = computed(() => branchNav.value.canGoNext);

async function handleCopyMessage() {
  await copy(flattenedContent.value);
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
          :filename="ɵgetUserMessageMediaFilename(part)"
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
